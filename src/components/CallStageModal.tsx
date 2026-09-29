import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  Phone,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  Volume2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { CallState, ChatRoom, UserProfile } from '../types';

interface CallStageModalProps {
  call: CallState;
  chat?: ChatRoom;
  currentUser: UserProfile;
  onEndCall: () => void;
  onUpdateCall: (patch: Partial<CallState>) => void;
  sendSignal: (payload: any) => void;
  incomingSignal: any | null;
}

const CALL_RING_DURATION_MS = 30000;

export const CallStageModal: React.FC<CallStageModalProps> = ({
  call,
  chat,
  currentUser,
  onEndCall,
  onUpdateCall,
  sendSignal,
  incomingSignal,
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null);

  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(18);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [usingSyntheticScreen, setUsingSyntheticScreen] = useState(false);

  const isOutgoing =
    call.direction === 'outgoing' || call.initiatorId === currentUser.id;
  const isRinging = call.status === 'ringing';

  const stopRingtone = () => {
    if (ringtoneAudioRef.current) {
      ringtoneAudioRef.current.pause();
      ringtoneAudioRef.current.currentTime = 0;
      ringtoneAudioRef.current = null;
    }
  };

  // Play /call.mp3 (outgoing) or /incomingcall.mp3 (incoming) for 30 seconds while ringing
  useEffect(() => {
    if (!isRinging) {
      stopRingtone();
      return;
    }

    const soundSrc = isOutgoing ? '/call.mp3' : '/incomingcall.mp3';
    const audio = new Audio(soundSrc);
    audio.loop = false;
    ringtoneAudioRef.current = audio;

    audio.play().catch(() => {});

    const timeoutId = setTimeout(() => {
      stopRingtone();
      sendSignal({
        type: 'call-timeout',
        callId: call.callId,
        chatId: call.chatId,
        senderId: currentUser.id,
      });
      onEndCall();
    }, CALL_RING_DURATION_MS);

    return () => {
      clearTimeout(timeoutId);
      stopRingtone();
    };
  }, [isRinging, isOutgoing, call.callId]);

  // Connected call duration timer
  useEffect(() => {
    if (call.status !== 'connected') {
      setElapsedSec(0);
      return;
    }
    const start = call.startedAt || Date.now();
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [call.status, call.startedAt]);

  // Initialize local media + WebRTC PeerConnection once connected
  useEffect(() => {
    if (call.status !== 'connected') return;

    let mounted = true;
    let audioCtx: AudioContext | null = null;
    let animId: number | null = null;

    async function initMediaAndRtc() {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerRef.current = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal({
            type: 'ice-candidate',
            callId: call.callId,
            chatId: call.chatId,
            senderId: currentUser.id,
            candidate: e.candidate,
          });
        }
      };

      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0];
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
        }
      };

      try {
        if (call.mode === 'screen') {
          await startScreenCapture(pc);
        } else {
          const wantVideo = call.mode === 'video';
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: wantVideo ? { width: 1280, height: 720 } : false,
          });
          if (!mounted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          localStreamRef.current = stream;
          if (localVideoRef.current && wantVideo) {
            localVideoRef.current.srcObject = stream;
          }
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));

          try {
            audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            source.connect(analyser);
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const tick = () => {
              analyser.getByteFrequencyData(dataArray);
              const avg =
                dataArray.reduce((acc, v) => acc + v, 0) / dataArray.length;
              setAudioLevel(Math.min(100, Math.max(8, Math.round(avg * 1.4))));
              animId = requestAnimationFrame(tick);
            };
            tick();
          } catch {
            // Ignore AudioContext restriction
          }
        }

        if (isOutgoing) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({
            type: 'offer',
            callId: call.callId,
            chatId: call.chatId,
            senderId: currentUser.id,
            senderName: currentUser.displayName,
            mode: call.mode,
            sdp: offer,
          });
        }
      } catch {
        if (!mounted) return;
        setMediaNotice(
          'Камера или микрофон недоступны — звонок продолжается в голосовом режиме.'
        );
      }
    }

    initMediaAndRtc();

    return () => {
      mounted = false;
      if (animId) cancelAnimationFrame(animId);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (peerRef.current) {
        peerRef.current.close();
      }
    };
  }, [call.status]);

  // Handle incoming call & WebRTC signals from other tabs/devices
  useEffect(() => {
    if (!incomingSignal || incomingSignal.senderId === currentUser.id) return;

    if (
      incomingSignal.type === 'call-accept' &&
      incomingSignal.chatId === call.chatId
    ) {
      stopRingtone();
      onUpdateCall({
        status: 'connected',
        remotePeerConnected: true,
        startedAt: Date.now(),
      });
      return;
    }

    if (
      (incomingSignal.type === 'call-reject' ||
        incomingSignal.type === 'call-end' ||
        incomingSignal.type === 'call-timeout') &&
      incomingSignal.chatId === call.chatId
    ) {
      stopRingtone();
      onEndCall();
      return;
    }

    const pc = peerRef.current;
    if (!pc) return;

    async function handleSignal() {
      try {
        if (incomingSignal.type === 'offer' && incomingSignal.sdp) {
          await pc!.setRemoteDescription(
            new RTCSessionDescription(incomingSignal.sdp)
          );
          const answer = await pc!.createAnswer();
          await pc!.setLocalDescription(answer);
          sendSignal({
            type: 'answer',
            callId: call.callId,
            chatId: call.chatId,
            senderId: currentUser.id,
            sdp: answer,
          });
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
        } else if (incomingSignal.type === 'answer' && incomingSignal.sdp) {
          await pc!.setRemoteDescription(
            new RTCSessionDescription(incomingSignal.sdp)
          );
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
        } else if (
          incomingSignal.type === 'ice-candidate' &&
          incomingSignal.candidate
        ) {
          await pc!.addIceCandidate(
            new RTCIceCandidate(incomingSignal.candidate)
          );
        }
      } catch (e) {
        console.error('WebRTC signal error:', e);
      }
    }

    handleSignal();
  }, [incomingSignal]);

  // Synthetic screen share fallback when browser blocks getDisplayMedia inside iframe
  useEffect(() => {
    if (!usingSyntheticScreen || !screenCanvasRef.current) return;
    const canvas = screenCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let raf: number;
    const draw = () => {
      frame++;
      ctx.fillStyle = '#0B0F17';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      ctx.fillStyle = '#1E293B';
      ctx.fillRect(36, 28, canvas.width - 72, 32);
      ctx.fillStyle = '#38BDF8';
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillText(
        `Демонстрация экрана · ${chat?.title || 'ClickChat'}`,
        52,
        48
      );

      ctx.fillStyle = '#0F172A';
      ctx.fillRect(36, 60, canvas.width - 72, canvas.height - 92);

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '500 13px Inter, sans-serif';
      ctx.fillText(`Трансляция экрана: ${currentUser.displayName}`, 56, 102);
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`Чат: ${chat?.title || 'ClickChat'}`, 56, 130);

      for (let i = 0; i < 24; i++) {
        const h = 18 + Math.sin(frame * 0.08 + i * 0.5) * 14;
        ctx.fillStyle = i % 3 === 0 ? '#38BDF8' : '#334155';
        ctx.fillRect(56 + i * 18, 225 - h, 12, h);
      }

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [usingSyntheticScreen, chat]);

  async function startScreenCapture(existingPc?: RTCPeerConnection) {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = displayStream;
      setUsingSyntheticScreen(false);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = displayStream;
      }
      const pc = existingPc || peerRef.current;
      if (pc) {
        displayStream
          .getTracks()
          .forEach((track) => pc.addTrack(track, displayStream));
      }
      displayStream.getVideoTracks()[0].onended = () => {
        onUpdateCall({ isScreenSharing: false });
      };
      onUpdateCall({ isScreenSharing: true, isCameraOn: false });
    } catch {
      setUsingSyntheticScreen(true);
      onUpdateCall({ isScreenSharing: true, isCameraOn: false });
      setMediaNotice('Включена демонстрация окна приложения.');
    }
  }

  const handleAcceptIncomingCall = () => {
    stopRingtone();
    const now = Date.now();
    onUpdateCall({
      status: 'connected',
      remotePeerConnected: true,
      startedAt: now,
    });
    sendSignal({
      type: 'call-accept',
      callId: call.callId,
      chatId: call.chatId,
      senderId: currentUser.id,
      senderName: currentUser.displayName,
    });
  };

  const handleRejectOrCancelCall = () => {
    stopRingtone();
    sendSignal({
      type: isRinging ? 'call-reject' : 'call-end',
      callId: call.callId,
      chatId: call.chatId,
      senderId: currentUser.id,
      senderName: currentUser.displayName,
    });
    onEndCall();
  };

  const toggleMute = () => {
    const nextMuted = !call.isMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }
    onUpdateCall({ isMuted: nextMuted });
  };

  const toggleCamera = async () => {
    const nextCam = !call.isCameraOn;
    if (nextCam) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: !call.isMuted,
        });
        localStreamRef.current = stream;
        setUsingSyntheticScreen(false);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        onUpdateCall({
          isCameraOn: true,
          isScreenSharing: false,
          mode: 'video',
        });
      } catch {
        setMediaNotice('Камера недоступна в текущем окружении браузера.');
        onUpdateCall({
          isCameraOn: true,
          isScreenSharing: false,
          mode: 'video',
        });
      }
    } else {
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => t.stop());
      }
      onUpdateCall({ isCameraOn: false });
    }
  };

  const toggleScreenShare = async () => {
    if (call.isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      setUsingSyntheticScreen(false);
      onUpdateCall({ isScreenSharing: false });
    } else {
      await startScreenCapture();
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // RENDER RINGING SCREEN (Outgoing or Incoming — plays /call.mp3 or /incomingcall.mp3 for 30s)
  if (isRinging) {
    const targetTitle = isOutgoing
      ? chat?.title || 'Собеседник'
      : call.initiatorName || chat?.title || 'Собеседник';

    return (
      <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-[#17212B] border border-slate-800 rounded-3xl w-full max-w-md p-8 flex flex-col items-center text-center shadow-2xl">
          <div className="relative mb-6">
            <span className="absolute -inset-4 rounded-full bg-sky-500/20 animate-ping" />
            <span className="absolute -inset-2 rounded-full bg-sky-500/30 animate-pulse" />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
              {targetTitle.slice(0, 2).toUpperCase()}
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/15 text-sky-400 text-xs font-medium mb-2">
            {isOutgoing ? (
              <>
                <PhoneOutgoing className="w-3.5 h-3.5" />
                <span>Исходящий звонок</span>
              </>
            ) : (
              <>
                <PhoneIncoming className="w-3.5 h-3.5" />
                <span>Входящий звонок</span>
              </>
            )}
          </div>

          <h2 className="text-xl font-bold text-white">{targetTitle}</h2>

          <p className="text-sm text-slate-300 mt-1">
            {isOutgoing
              ? 'Идёт вызов...'
              : `${call.initiatorName || 'Собеседник'} звонит вам (${
                  call.mode === 'video' ? 'Видеозвонок' : 'Аудиозвонок'
                })`}
          </p>

          <div className="mt-8 flex items-center justify-center gap-6 w-full">
            {!isOutgoing && (
              <button
                type="button"
                onClick={handleAcceptIncomingCall}
                className="flex-1 py-3.5 px-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition-colors"
              >
                <Phone className="w-4 h-4" />
                <span>Принять</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleRejectOrCancelCall}
              className="flex-1 py-3.5 px-5 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-red-600/25 transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
              <span>{isOutgoing ? 'Сбросить' : 'Отклонить'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        className={`bg-[#0B0F17] border border-slate-800 rounded-xl flex flex-col overflow-hidden transition-transform duration-150 ${
          expanded ? 'w-full h-full max-w-6xl max-h-[92vh]' : 'w-full max-w-3xl'
        }`}
      >
        {/* Call Top Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800/80 bg-[#111827]">
          <div className="flex items-center gap-3 min-w-0">
            <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="truncate">
              <span className="text-sm font-semibold text-slate-100">
                {chat?.title || 'Звонок ClickChat'}
              </span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-xs font-mono tabular-nums text-emerald-400">
                {formatDuration(elapsedSec)}
              </span>
            </div>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
            title={expanded ? 'Свернуть окно' : 'Развернуть окно'}
          >
            {expanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Media Stage */}
        <div className="relative bg-[#080B11] flex-1 min-h-[340px] grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
          {/* Local Stream / Screen Share */}
          <div className="relative rounded-lg bg-slate-900/90 border border-slate-800 overflow-hidden flex flex-col items-center justify-center min-h-[260px]">
            {usingSyntheticScreen ? (
              <canvas
                ref={screenCanvasRef}
                width={560}
                height={300}
                className="w-full h-full object-contain"
              />
            ) : call.isCameraOn || call.isScreenSharing ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            ) : null}

            {!call.isCameraOn &&
              !call.isScreenSharing &&
              !usingSyntheticScreen && (
                <div className="flex flex-col items-center gap-3 p-6 text-center">
                  <div className="w-16 h-16 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg font-semibold text-sky-400">
                    {currentUser.displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {currentUser.displayName} (Вы)
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {call.isMuted ? 'Микрофон отключен' : 'Микрофон включен'}
                    </p>
                  </div>
                  <div className="flex items-end gap-1 h-6 mt-1">
                    {[0.5, 0.9, 1.2, 0.7, 1.1, 0.8, 0.4].map((mult, idx) => (
                      <span
                        key={idx}
                        className="w-1.5 bg-sky-400 rounded-sm transition-all duration-150"
                        style={{
                          height: call.isMuted
                            ? '4px'
                            : `${Math.min(
                                24,
                                Math.max(4, Math.round((audioLevel / 4) * mult))
                              )}px`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

            <div className="absolute bottom-3 left-3 text-xs text-slate-300 bg-black/65 px-2.5 py-1 rounded">
              {currentUser.displayName} ·{' '}
              {call.isScreenSharing
                ? 'Демонстрация экрана'
                : call.isCameraOn
                ? 'Камера'
                : 'Аудио'}
            </div>
          </div>

          {/* Remote Participant Stage */}
          <div className="relative rounded-lg bg-slate-900/90 border border-slate-800 overflow-hidden flex flex-col items-center justify-center min-h-[260px]">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`w-full h-full object-cover ${
                call.remotePeerConnected ? 'block' : 'hidden'
              }`}
            />

            {!call.remotePeerConnected && (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <div className="w-16 h-16 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg font-semibold text-slate-200">
                  {(chat?.title || 'CC').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    {chat?.title || 'Собеседник'}
                  </p>
                  <p className="text-xs text-emerald-400 mt-0.5 flex items-center justify-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" />
                    На связи
                  </p>
                </div>
              </div>
            )}

            <div className="absolute bottom-3 left-3 text-xs text-slate-300 bg-black/65 px-2.5 py-1 rounded">
              {chat?.title || 'Собеседник'}
            </div>
          </div>
        </div>

        {mediaNotice && (
          <div className="px-5 py-2 bg-slate-900 border-t border-slate-800 text-xs text-slate-400">
            {mediaNotice}
          </div>
        )}

        {/* Call Controls Bar */}
        <div className="flex items-center justify-center px-6 py-4 bg-[#111827] border-t border-slate-800">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleMute}
              className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                call.isMuted
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              {call.isMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
              <span>{call.isMuted ? 'Включить микрофон' : 'Микрофон'}</span>
            </button>

            <button
              onClick={toggleCamera}
              className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                call.isCameraOn
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              {call.isCameraOn ? (
                <Video className="w-4 h-4" />
              ) : (
                <VideoOff className="w-4 h-4" />
              )}
              <span>{call.isCameraOn ? 'Камера вкл.' : 'Видеокамера'}</span>
            </button>

            <button
              onClick={toggleScreenShare}
              className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                call.isScreenSharing
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>
                {call.isScreenSharing ? 'Остановить экран' : 'Экран'}
              </span>
            </button>

            <button
              onClick={handleRejectOrCancelCall}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Завершить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
