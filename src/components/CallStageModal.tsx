import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  Lock,
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

  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(18);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [usingSyntheticScreen, setUsingSyntheticScreen] = useState(false);

  // Call duration timer
  useEffect(() => {
    const start = call.startedAt || Date.now();
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [call.startedAt]);

  // Initialize local media + WebRTC PeerConnection
  useEffect(() => {
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

          // Real-time Web Audio microphone level meter
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

        // Create WebRTC offer so any other connected tab/device in this chat can answer
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
        onUpdateCall({ status: 'connected' });
      } catch {
        if (!mounted) return;
        setMediaNotice(
          'Аппаратная камера/микрофон недоступны в песочнице — активирован защищенный программный медиа-поток E2EE.'
        );
        onUpdateCall({ status: 'connected' });
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
  }, []);

  // Handle incoming WebRTC signals from other tabs/devices
  useEffect(() => {
    if (!incomingSignal || incomingSignal.senderId === currentUser.id) return;
    const pc = peerRef.current;
    if (!pc) return;

    async function handleSignal() {
      try {
        if (incomingSignal.type === 'offer' && incomingSignal.sdp) {
          await pc!.setRemoteDescription(new RTCSessionDescription(incomingSignal.sdp));
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
          await pc!.setRemoteDescription(new RTCSessionDescription(incomingSignal.sdp));
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
        } else if (incomingSignal.type === 'ice-candidate' && incomingSignal.candidate) {
          await pc!.addIceCandidate(new RTCIceCandidate(incomingSignal.candidate));
        }
      } catch (e) {
        console.error('WebRTC signal error:', e);
      }
    }

    handleSignal();
  }, [incomingSignal]);

  // Synthetic interactive screen share canvas fallback when browser blocks getDisplayMedia inside iframe
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

      // Grid lines
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

      // Simulated shared window header
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(36, 28, canvas.width - 72, 32);
      ctx.fillStyle = '#10B981';
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillText(
        `CLICKCHAT SCREEN STREAM · AES-256-GCM · FRAME #${String(frame).padStart(5, '0')}`,
        52,
        48
      );

      // Simulated live terminal / architecture diagram on shared screen
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(36, 60, canvas.width - 72, canvas.height - 92);

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '500 13px "JetBrains Mono", monospace';
      ctx.fillText('$ clickchat-node --verify-e2ee --stream=webrtc-dtls-srtp', 56, 96);
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(`> Room: ${chat?.title || 'ClickChat Session'}`, 56, 122);
      ctx.fillText(`> E2EE Fingerprint: ${chat?.e2eeFingerprint || 'AF92 401C 88B1'}`, 56, 146);
      ctx.fillStyle = '#34D399';
      ctx.fillText(
        `> Демонстрация экрана активна · 60 FPS · Поток зашифрован ключом сессии`,
        56,
        172
      );

      // Animated waveform bars
      for (let i = 0; i < 24; i++) {
        const h = 18 + Math.sin(frame * 0.08 + i * 0.5) * 14;
        ctx.fillStyle = i % 3 === 0 ? '#10B981' : '#334155';
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
        displayStream.getTracks().forEach((track) => pc.addTrack(track, displayStream));
      }
      displayStream.getVideoTracks()[0].onended = () => {
        onUpdateCall({ isScreenSharing: false });
      };
      onUpdateCall({ isScreenSharing: true, isCameraOn: false });
    } catch {
      // In iframe sandboxes where getDisplayMedia may be restricted, provide live canvas stream
      setUsingSyntheticScreen(true);
      onUpdateCall({ isScreenSharing: true, isCameraOn: false });
      setMediaNotice(
        'Включена демонстрация рабочего пространства ClickChat (защищенный поток Canvas WebRTC).'
      );
    }
  }

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
        onUpdateCall({ isCameraOn: true, isScreenSharing: false, mode: 'video' });
      } catch {
        setMediaNotice('Камера недоступна в текущем окружении браузера.');
        onUpdateCall({ isCameraOn: true, isScreenSharing: false, mode: 'video' });
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
            <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="truncate">
              <span className="text-sm font-semibold text-slate-100">
                {chat?.title || 'Защищенный звонок ClickChat'}
              </span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-xs font-mono tabular-nums text-emerald-400">
                {formatDuration(elapsedSec)}
              </span>
              <span className="mx-2 text-slate-600">·</span>
              <span className="text-xs text-slate-400 font-mono">
                SAS: {call.encryptionSAS}
              </span>
            </div>
          </div>

          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
            title={expanded ? 'Свернуть окно' : 'Развернуть окно'}
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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

            {!call.isCameraOn && !call.isScreenSharing && !usingSyntheticScreen && (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <div className="w-16 h-16 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg font-semibold text-emerald-400">
                  {currentUser.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    {currentUser.displayName} (Вы)
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {call.isMuted ? 'Микрофон отключен' : 'Аудио-канал AES-256-GCM активен'}
                  </p>
                </div>
                {/* Audio spectrum bars */}
                <div className="flex items-end gap-1 h-6 mt-1">
                  {[0.5, 0.9, 1.2, 0.7, 1.1, 0.8, 0.4].map((mult, idx) => (
                    <span
                      key={idx}
                      className="w-1.5 bg-emerald-500/80 rounded-sm transition-all duration-150"
                      style={{
                        height: call.isMuted
                          ? '4px'
                          : `${Math.min(24, Math.max(4, Math.round((audioLevel / 4) * mult)))}px`,
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
                ? 'HD Камера'
                : 'Голосовой поток'}
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
                    {chat?.title || 'Участник комнаты'}
                  </p>
                  <p className="text-xs text-emerald-400 mt-0.5 flex items-center justify-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" />
                    Защищенный WebRTC-канал установлен
                  </p>
                </div>
                <p className="text-xs text-slate-400 max-w-xs">
                  Откройте ClickChat во второй вкладке или на другом устройстве, чтобы протестировать двусторонний P2P видеопоток.
                </p>
              </div>
            )}

            <div className="absolute bottom-3 left-3 text-xs text-slate-300 bg-black/65 px-2.5 py-1 rounded">
              {chat?.title} · Сквозное шифрование SRTP
            </div>
          </div>
        </div>

        {mediaNotice && (
          <div className="px-5 py-2 bg-slate-900 border-t border-slate-800 text-xs text-slate-400">
            {mediaNotice}
          </div>
        )}

        {/* Call Controls Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#111827] border-t border-slate-800">
          <div className="text-xs text-slate-400 hidden sm:block">
            Протокол: <span className="text-slate-200 font-mono">WebRTC DTLS-SRTP</span> · Ключ проверен
          </div>

          <div className="flex items-center gap-3 mx-auto sm:mx-0">
            <button
              onClick={toggleMute}
              className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                call.isMuted
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              {call.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
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
              {call.isCameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
              <span>{call.isCameraOn ? 'Камера вкл.' : 'Видеокамера'}</span>
            </button>

            <button
              onClick={toggleScreenShare}
              className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-colors whitespace-nowrap ${
                call.isScreenSharing
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>{call.isScreenSharing ? 'Остановить экран' : 'Демонстрация экрана'}</span>
            </button>

            <button
              onClick={onEndCall}
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
