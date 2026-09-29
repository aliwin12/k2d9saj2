import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { FileAttachment } from '../types';

interface VoiceMessagePlayerProps {
  attachment: FileAttachment;
  isOwn?: boolean;
}

const DEFAULT_WAVEFORM = [
  0.25, 0.45, 0.7, 0.35, 0.85, 0.6, 0.9, 0.5, 0.4, 0.75, 0.95, 0.65, 0.3, 0.55,
  0.8, 0.45, 0.6, 0.7, 0.35, 0.5, 0.65, 0.4, 0.3, 0.5,
];

export const VoiceMessagePlayer: React.FC<VoiceMessagePlayerProps> = ({
  attachment,
  isOwn = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(attachment.durationSeconds || 0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);

  const bars =
    attachment.waveform && attachment.waveform.length > 0
      ? attachment.waveform
      : DEFAULT_WAVEFORM;

  useEffect(() => {
    const audio = new Audio(attachment.dataUrl);
    audioRef.current = audio;

    const onLoadedMetadata = () => {
      if (
        audio.duration &&
        isFinite(audio.duration) &&
        !isNaN(audio.duration)
      ) {
        setDuration(audio.duration);
      }
    };

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [attachment.dataUrl]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        audio.playbackRate = playbackRate;
        await audio.play();
        setIsPlaying(true);
      } catch (err) {
        console.error('Audio playback failed:', err);
      }
    }
  };

  const handleSeek = (index: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const ratio = (index + 0.5) / bars.length;
    const nextTime = ratio * duration;
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const cycleSpeed = () => {
    const nextRate: 1 | 1.5 | 2 =
      playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const formatSeconds = (sec: number) => {
    const safe = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressRatio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <div className="mt-1 py-1.5 px-2.5 rounded-xl bg-black/20 flex items-center gap-3 min-w-[230px] sm:min-w-[260px]">
      <button
        type="button"
        onClick={togglePlay}
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          isOwn
            ? 'bg-sky-400 text-slate-950 hover:bg-sky-300'
            : 'bg-sky-500 text-white hover:bg-sky-400'
        }`}
        title={isPlaying ? 'Пауза' : 'Воспроизвести голосовое сообщение'}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-end gap-[3px] h-6 cursor-pointer">
          {bars.map((val, idx) => {
            const barProgress = idx / bars.length;
            const active = barProgress <= progressRatio;
            const heightPx = Math.max(4, Math.min(22, Math.round(val * 22)));
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSeek(idx)}
                style={{ height: `${heightPx}px` }}
                className={`flex-1 min-w-[3px] rounded-full transition-colors ${
                  active
                    ? 'bg-sky-300'
                    : isOwn
                    ? 'bg-white/30 hover:bg-white/50'
                    : 'bg-slate-500/50 hover:bg-slate-400'
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-300 tabular-nums">
          <span>
            {isPlaying || currentTime > 0
              ? `${formatSeconds(currentTime)} / ${formatSeconds(duration)}`
              : formatSeconds(duration || attachment.durationSeconds || 1)}
          </span>
          <button
            type="button"
            onClick={cycleSpeed}
            className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] font-semibold text-sky-200 transition-colors"
            title="Скорость воспроизведения"
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
};
