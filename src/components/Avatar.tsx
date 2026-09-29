import React, { useState } from 'react';
import { Radio, Users, Bot, Shield } from 'lucide-react';

interface AvatarProps {
  src?: string;
  title: string;
  type?: 'direct' | 'group' | 'channel' | 'bot';
  status?: 'online' | 'away' | 'offline';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  title,
  type = 'direct',
  status,
  size = 'md',
}) => {
  const [imgError, setImgError] = useState(false);

  const dimensions =
    size === 'sm'
      ? 'w-9 h-9 text-xs'
      : size === 'lg'
      ? 'w-12 h-12 text-base'
      : size === 'xl'
      ? 'w-16 h-16 text-lg'
      : 'w-11 h-11 text-sm';

  const initials = (title || 'CC')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  // Subtle deterministic color based on title
  const palettes = [
    'from-sky-500 to-blue-600',
    'from-emerald-500 to-teal-600',
    'from-indigo-500 to-blue-700',
    'from-amber-500 to-orange-600',
    'from-cyan-500 to-blue-600',
  ];
  const colorIdx =
    title.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) %
    palettes.length;

  return (
    <div
      className={`relative shrink-0 ${dimensions} rounded-full flex items-center justify-center overflow-hidden select-none`}
    >
      {src && !imgError ? (
        <img
          src={src}
          alt={title}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover rounded-full"
        />
      ) : type === 'channel' ? (
        <div
          className={`w-full h-full bg-gradient-to-br ${palettes[colorIdx]} flex items-center justify-center text-white`}
        >
          <Radio className="w-5 h-5" />
        </div>
      ) : type === 'group' ? (
        <div
          className={`w-full h-full bg-gradient-to-br ${palettes[colorIdx]} flex items-center justify-center text-white`}
        >
          <Users className="w-5 h-5" />
        </div>
      ) : type === 'bot' ? (
        <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white">
          <Bot className="w-5 h-5" />
        </div>
      ) : (
        <div
          className={`w-full h-full bg-gradient-to-br ${palettes[colorIdx]} flex items-center justify-center font-semibold text-white`}
        >
          {initials || <Shield className="w-4 h-4 text-white" />}
        </div>
      )}

      {status && type === 'direct' && (
        <span
          title={status === 'online' ? 'В сети' : 'Не в сети'}
          className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#17212B] ${
            status === 'online'
              ? 'bg-emerald-400'
              : status === 'away'
              ? 'bg-amber-400'
              : 'bg-slate-500'
          }`}
        />
      )}
    </div>
  );
};
