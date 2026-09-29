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
  ChevronUp,
  ChevronDown,
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
  incomingSignalsQueue?: any[];
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
  incomingSignalsQueue = [],
}) => {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const ringtoneAudioRef = useRef<HTMLAudioElement | null>(null);

  const pendingOffersRef = useRef< any[] >([]);
  const pendingCandidatesRef = useRef< RTCIceCandidateInit[] >([]);
  const processedSigSetRef = useRef<Set<string>>(new Set());

  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioLevel, setAudioLevel] = useState(18);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  const isOutgoing =
    call.direction === 'outgoing' || call.initiatorId === currentUser.id;
  const isRinging = call.status === 'ringing';
  const isMinimized = Boolean(call.minimized);

  const stopRingtone = () => {
    if (ringtoneAudioRef.current) {
      ringtoneAudioRef.current.pause();
      ringtoneAudioRef.current.currentTime = 0;
      ringtoneAudioRef.current = null;
    }
  };

  // Re-attach local/remote streams to video elements when switching between minimized and full view
  useEffect(() => {
    if (localVideoRef.current) {
      if (call.isScreenSharing && screenStreamRef.current) {
        localVideoRef.current.srcObject = screenStreamRef.current;
      } else if (call.isCameraOn && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      } else {
        localVideoRef.current.srcObject = null;
      }
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [isMinimized, call.isCameraOn, call.isScreenSharing, hasRemoteVideo]);

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

  async function renegotiateWithPeer(pc: RTCPeerConnection) {
    try {
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
    } catch (e) {
      console.error('Renegotiation error:', e);
    }
  }

  async function processBufferedSignals(pc: RTCPeerConnection) {
    while (pendingOffersRef.current.length > 0) {
      const sig = pendingOffersRef.current.shift();
      if (!sig) continue;
      try {
        if (sig.type === 'offer' && sig.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({
            type: 'answer',
            callId: call.callId,
            chatId: call.chatId,
            senderId: currentUser.id,
            sdp: answer,
          });
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
        } else if (sig.type === 'answer' && sig.sdp) {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          }
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
        }
      } catch (e) {
        console.error('Error applying buffered SDP:', e);
      }
    }

    while (pendingCandidatesRef.current.length > 0) {
      const cand = pendingCandidatesRef.current.shift();
      if (!cand) continue;
      try {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
      } catch {
        // Ignore duplicate ICE candidate
      }
    }
  }

  // Initialize local media + WebRTC PeerConnection once connected
  useEffect(() => {
    if (call.status !== 'connected') return;

    let mounted = true;
    let audioCtx: AudioContext | null = null;
    let animId: number | null = null;

    async function initMediaAndRtc() {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      peerRef.current = pc;

      const inboundStream = new MediaStream();
      remoteStreamRef.current = inboundStream;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal({
            type: 'ice-candidate',
            callId: call.callId,
            chatId: call.chatId,
            senderId: currentUser.id,
            candidate: e.candidate.toJSON
              ? e.candidate.toJSON()
              : e.candidate,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === 'connected' ||
          pc.iceConnectionState === 'connected'
        ) {
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams && e.streams[0] ? e.streams[0] : inboundStream;
        if (!e.streams || !e.streams[0]) {
          inboundStream.addTrack(e.track);
        }
        remoteStreamRef.current = stream;

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(() => {});
        }

        if (e.track.kind === 'video') {
          setHasRemoteVideo(true);
          e.track.onended = () => setHasRemoteVideo(false);
          e.track.onmute = () => setHasRemoteVideo(false);
          e.track.onunmute = () => setHasRemoteVideo(true);
        }
        onUpdateCall({ remotePeerConnected: true, status: 'connected' });
      };

      // Always try to get microphone (and camera if video mode)
      try {
        const wantVideo = call.mode === 'video';
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: wantVideo ? { width: 1280, height: 720 } : false,
          });
        } catch {
          if (wantVideo) {
            // Fallback to audio-only if camera is unavailable
            stream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false,
            });
            onUpdateCall({ isCameraOn: false });
          }
        }

        if (stream && mounted) {
          localStreamRef.current = stream;
          if (localVideoRef.current && wantVideo && stream.getVideoTracks().length > 0) {
            localVideoRef.current.srcObject = stream;
          }
          stream.getTracks().forEach((track) => {
            if (track.kind === 'audio') {
              track.enabled = !call.isMuted;
            }
            pc.addTrack(track, stream!);
          });

          try {
            const AudioContextClass =
              window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
              audioCtx = new AudioContextClass();
              const source = audioCtx.createMediaStreamSource(stream);
              const analyser = audioCtx.createAnalyser();
              analyser.fftSize = 64;
              source.connect(analyser);
              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              const tick = () => {
                analyser.getByteFrequencyData(dataArray);
                const avg =
                  dataArray.reduce((acc, v) => acc + v, 0) / dataArray.length;
                setAudioLevel(
                  Math.min(100, Math.max(8, Math.round(avg * 1.4)))
                );
                animId = requestAnimationFrame(tick);
              };
              tick();
            }
          } catch {
            // Ignore AudioContext restriction
          }
        }
      } catch {
        if (mounted) {
          setMediaNotice('Не удалось получить доступ к микрофону в браузере.');
        }
      }

      // If call was initiated in screen mode, request real screen stream
      if (call.mode === 'screen' && mounted) {
        const startedScreen = await startScreenCapture(pc);
        if (!startedScreen && mounted) {
          onUpdateCall({ isScreenSharing: false, mode: 'audio' });
        }
      }

      // Process any offers/candidates that arrived while getUserMedia was running
      await processBufferedSignals(pc);

      // If outgoing caller, send initial WebRTC offer
      if (isOutgoing && mounted) {
        await renegotiateWithPeer(pc);
      }
    }

    initMediaAndRtc();

    return () => {
      mounted = false;
      if (animId) cancelAnimationFrame(animId);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }
    };
  }, [call.status]);

  // Handle incoming signals (both single incomingSignal and incomingSignalsQueue)
  useEffect(() => {
    const allSignals = [
      ...(incomingSignalsQueue || []),
      ...(incomingSignal ? [incomingSignal] : []),
    ];
    if (allSignals.length === 0) return;

    async function handleSignalItem(sig: any) {
      if (!sig || sig.senderId === currentUser.id) return;
      const sigKey =
        sig.signalId || `${sig.type}_${sig.callId}_${sig.timestamp || ''}`;
      if (sig.signalId && processedSigSetRef.current.has(sigKey)) return;
      if (sig.signalId) processedSigSetRef.current.add(sigKey);

      if (sig.type === 'call-accept' && sig.chatId === call.chatId) {
        stopRingtone();
        onUpdateCall({
          status: 'connected',
          remotePeerConnected: true,
          startedAt: Date.now(),
        });
        return;
      }

      if (
        (sig.type === 'call-reject' ||
          sig.type === 'call-end' ||
          sig.type === 'call-timeout') &&
        sig.chatId === call.chatId
      ) {
        stopRingtone();
        onEndCall();
        return;
      }

      if (sig.type === 'media-state' && sig.chatId === call.chatId) {
        setHasRemoteVideo(Boolean(sig.hasVideo));
        return;
      }

      const pc = peerRef.current;
      if (!pc) {
        if (sig.type === 'offer' || sig.type === 'answer') {
          pendingOffersRef.current.push(sig);
        } else if (sig.type === 'ice-candidate' && sig.candidate) {
          pendingCandidatesRef.current.push(sig.candidate);
        }
        return;
      }

      try {
        if (sig.type === 'offer' && sig.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({
            type: 'answer',
            callId: call.callId,
            chatId: call.chatId,
            senderId: currentUser.id,
            sdp: answer,
          });
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
          await processBufferedSignals(pc);
        } else if (sig.type === 'answer' && sig.sdp) {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          }
          onUpdateCall({ remotePeerConnected: true, status: 'connected' });
          await processBufferedSignals(pc);
        } else if (sig.type === 'ice-candidate' && sig.candidate) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(sig.candidate));
          } else {
            pendingCandidatesRef.current.push(sig.candidate);
          }
        }
      } catch (e) {
        console.error('WebRTC signal error:', e);
      }
    }

    allSignals.forEach((sig) => {
      handleSignalItem(sig);
    });
  }, [incomingSignal, incomingSignalsQueue.length]);

  // Start real screen capture ONLY if real display stream arrives; otherwise cancel screen share
  async function startScreenCapture(
    existingPc?: RTCPeerConnection
  ): Promise<boolean> {
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getDisplayMedia !== 'function'
    ) {
      setMediaNotice(
        'Ваш браузер не передал поток демонстрации экрана — запуск демонстрации отменён.'
      );
      onUpdateCall({ isScreenSharing: false });
      return false;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const screenVideoTrack = displayStream?.getVideoTracks()?.[0];
      if (!screenVideoTrack || screenVideoTrack.readyState !== 'live') {
        if (displayStream) {
          displayStream.getTracks().forEach((t) => t.stop());
        }
        onUpdateCall({ isScreenSharing: false });
        return false;
      }

      // Real screen share stream arrived — launch completely!
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      screenStreamRef.current = displayStream;
      setMediaNotice(null);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = displayStream;
        localVideoRef.current.play().catch(() => {});
      }

      const pc = existingPc || peerRef.current;
      if (pc) {
        const videoSender = pc
          .getSenders()
          .find((s) => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(screenVideoTrack);
        } else {
          pc.addTrack(screenVideoTrack, displayStream);
        }
        await renegotiateWithPeer(pc);
      }

      sendSignal({
        type: 'media-state',
        callId: call.callId,
        chatId: call.chatId,
        senderId: currentUser.id,
        hasVideo: true,
      });

      screenVideoTrack.onended = () => {
        stopScreenCapture();
      };

      onUpdateCall({
        isScreenSharing: true,
        isCameraOn: false,
        mode: 'screen',
      });
      return true;
    } catch {
      // No stream arrived or user cancelled — cancel screen share immediately
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      onUpdateCall({
        isScreenSharing: false,
        mode: call.isCameraOn ? 'video' : 'audio',
      });
      return false;
    }
  }

  async function stopScreenCapture() {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject =
        call.isCameraOn && localStreamRef.current
          ? localStreamRef.current
          : null;
    }
    const pc = peerRef.current;
    if (pc) {
      const videoSender = pc
        .getSenders()
        .find((s) => s.track && s.track.kind === 'video');
      if (videoSender) {
        await videoSender.replaceTrack(null);
      }
      await renegotiateWithPeer(pc);
    }
    sendSignal({
      type: 'media-state',
      callId: call.callId,
      chatId: call.chatId,
      senderId: currentUser.id,
      hasVideo: false,
    });
    onUpdateCall({
      isScreenSharing: false,
      mode: call.isCameraOn ? 'video' : 'audio',
    });
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
        if (call.isScreenSharing) {
          await stopScreenCapture();
        }
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: false,
        });
        const camTrack = camStream.getVideoTracks()[0];
        if (!camTrack) {
          setMediaNotice('Веб-камера не найдена.');
          return;
        }

        if (!localStreamRef.current) {
          localStreamRef.current = camStream;
        } else {
          localStreamRef.current
            .getVideoTracks()
            .forEach((old) => {
              old.stop();
              localStreamRef.current?.removeTrack(old);
            });
          localStreamRef.current.addTrack(camTrack);
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => {});
        }

        const pc = peerRef.current;
        if (pc) {
          const videoSender = pc
            .getSenders()
            .find((s) => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(camTrack);
          } else {
            pc.addTrack(camTrack, localStreamRef.current);
          }
          await renegotiateWithPeer(pc);
        }

        sendSignal({
          type: 'media-state',
          callId: call.callId,
          chatId: call.chatId,
          senderId: currentUser.id,
          hasVideo: true,
        });

        setMediaNotice(null);
        onUpdateCall({
          isCameraOn: true,
          isScreenSharing: false,
          mode: 'video',
        });
      } catch {
        setMediaNotice('Не удалось включить веб-камеру. Проверьте разрешения браузера.');
        onUpdateCall({ isCameraOn: false });
      }
    } else {
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => {
          t.stop();
          localStreamRef.current?.removeTrack(t);
        });
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      const pc = peerRef.current;
      if (pc) {
        const videoSender = pc
          .getSenders()
          .find((s) => s.track && s.track.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(null);
        }
        await renegotiateWithPeer(pc);
      }
      sendSignal({
        type: 'media-state',
        callId: call.callId,
        chatId: call.chatId,
        senderId: currentUser.id,
        hasVideo: false,
      });
      onUpdateCall({ isCameraOn: false, mode: 'audio' });
    }
  };

  const toggleScreenShare = async () => {
    if (call.isScreenSharing) {
      await stopScreenCapture();
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

  const targetTitle = isOutgoing
    ? chat?.title || 'Собеседник'
    : call.initiatorName || chat?.title || 'Собеседник';

  // Persistent hidden audio element so remote voice is always heard even when minimized
  const persistentAudioElement = (
    <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
  );

  // ============================================================================
  // MINIMIZED TOP BAR MODE («свернуть звонок наверх»)
  // ============================================================================
  if (isMinimized) {
    return (
      <>
        {persistentAudioElement}
        <div className="fixed top-0 left-0 right-0 z-50 bg-[#111827]/95 backdrop-blur-md border-b border-sky-500/30 px-4 py-2 shadow-xl flex items-center justify-between gap-4">
          <div
            onClick={() => onUpdateCall({ minimized: false })}
            className="flex items-center gap-3 min-w-0 cursor-pointer group"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-xs font-semibold text-white truncate group-hover:text-sky-300 transition-colors">
              {targetTitle}
            </span>
            <span className="text-xs font-mono tabular-nums text-emerald-400">
              {isRinging
                ? isOutgoing
                  ? 'Вызов...'
                  : 'Входящий звонок'
                : formatDuration(elapsedSec)}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isRinging && !isOutgoing ? (
              <>
                <button
                  type="button"
                  onClick={handleAcceptIncomingCall}
                  className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>Принять</span>
                </button>
                <button
                  type="button"
                  onClick={handleRejectOrCancelCall}
                  className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span>Отклонить</span>
                </button>
              </>
            ) : (
              <>
                {!isRinging && (
                  <>
                    <button
                      type="button"
                      onClick={toggleMute}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        call.isMuted
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                      }`}
                      title={
                        call.isMuted ? 'Включить микрофон' : 'Выключить микрофон'
                      }
                    >
                      {call.isMuted ? (
                        <MicOff className="w-3.5 h-3.5" />
                      ) : (
                        <Mic className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={toggleCamera}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        call.isCameraOn
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                      }`}
                      title="Веб-камера"
                    >
                      {call.isCameraOn ? (
                        <Video className="w-3.5 h-3.5" />
                      ) : (
                        <VideoOff className="w-3.5 h-3.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={toggleScreenShare}
                      className={`p-1.5 rounded-lg text-xs transition-colors ${
                        call.isScreenSharing
                          ? 'bg-sky-500 text-slate-950'
                          : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                      }`}
                      title="Демонстрация экрана"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => onUpdateCall({ minimized: false })}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1"
                  title="Развернуть звонок"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Развернуть</span>
                </button>

                <button
                  type="button"
                  onClick={handleRejectOrCancelCall}
                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1"
                  title="Завершить звонок"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Сбросить</span>
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  // ============================================================================
  // RINGING SCREEN (Outgoing or Incoming — plays /call.mp3 or /incomingcall.mp3 for 30s)
  // ============================================================================
  if (isRinging) {
    return (
      <>
        {persistentAudioElement}
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative bg-[#17212B] border border-slate-800 rounded-3xl w-full max-w-md p-8 flex flex-col items-center text-center shadow-2xl">
            <button
              type="button"
              onClick={() => onUpdateCall({ minimized: true })}
              className="absolute top-4 right-4 px-2.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1 transition-colors"
              title="Свернуть звонок наверх"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Свернуть</span>
            </button>

            <div className="relative mb-6 mt-2">
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
      </>
    );
  }

  return (
    <>
      {persistentAudioElement}
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div
          className={`bg-[#0B0F17] border border-slate-800 rounded-xl flex flex-col overflow-hidden transition-transform duration-150 ${
            expanded
              ? 'w-full h-full max-w-6xl max-h-[92vh]'
              : 'w-full max-w-3xl'
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

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdateCall({ minimized: true })}
                className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center gap-1 transition-colors"
                title="Свернуть звонок наверх"
              >
                <ChevronUp className="w-4 h-4" />
                <span>Свернуть наверх</span>
              </button>

              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
                title={expanded ? 'Уменьшить окно' : 'На весь экран'}
              >
                {expanded ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Media Stage */}
          <div className="relative bg-[#080B11] flex-1 min-h-[340px] grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
            {/* Local Stream / Screen Share */}
            <div className="relative rounded-lg bg-slate-900/90 border border-slate-800 overflow-hidden flex flex-col items-center justify-center min-h-[260px]">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${
                  call.isCameraOn || call.isScreenSharing ? 'block' : 'hidden'
                }`}
              />

              {!call.isCameraOn && !call.isScreenSharing && (
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
                  ? 'Веб-камера'
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
                  hasRemoteVideo ? 'block' : 'hidden'
                }`}
              />

              {!hasRemoteVideo && (
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
                      {call.remotePeerConnected
                        ? 'Аудио-соединение активно'
                        : 'Подключение...'}
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
            <div className="px-5 py-2 bg-slate-900 border-t border-slate-800 text-xs text-amber-300">
              {mediaNotice}
            </div>
          )}

          {/* Call Controls Bar */}
          <div className="flex items-center justify-center px-6 py-4 bg-[#111827] border-t border-slate-800">
            <div className="flex flex-wrap items-center justify-center gap-3">
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
                <span>{call.isCameraOn ? 'Камера вкл.' : 'Веб-камера'}</span>
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
                  {call.isScreenSharing
                    ? 'Остановить экран'
                    : 'Демонстрация экрана'}
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
    </>
  );
};
