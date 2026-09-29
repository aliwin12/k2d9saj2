import React, { useState } from 'react';
import {
  Lock,
  RefreshCw,
  Download,
  FileText,
  Bot,
  Users,
  X,
  Phone,
  Video,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { BotApp, ChatRoom, Message, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface RightInspectorPanelProps {
  chat: ChatRoom;
  messages: Message[];
  users: UserProfile[];
  bots: BotApp[];
  inspectedMessage: Message | null;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
  onStartCall: (mode: 'audio' | 'video' | 'screen') => void;
  onClearInspectedMessage: () => void;
  onRotateRoomKeys: () => void;
  onOpenBotDrawer: () => void;
  onClosePanel: () => void;
}

export const RightInspectorPanel: React.FC<RightInspectorPanelProps> = ({
  chat,
  messages,
  users,
  bots,
  inspectedMessage,
  notificationsEnabled,
  onToggleNotifications,
  onStartCall,
  onClearInspectedMessage,
  onRotateRoomKeys,
  onOpenBotDrawer,
  onClosePanel,
}) => {
  const [showCryptoDetails, setShowCryptoDetails] = useState(false);

  const roomMembers = users.filter((u) => chat.memberIds.includes(u.id));
  const roomBots = bots.filter((b) => (chat.botIds || []).includes(b.id));
  const sharedFiles = messages.filter((m) => m.attachment);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <aside className="w-80 shrink-0 border-l border-slate-800/80 bg-[#17212B] flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-slate-800/80">
        <span className="text-sm font-semibold text-slate-100">
          {chat.type === 'channel'
            ? 'Информация о канале'
            : chat.type === 'group'
            ? 'Информация о группе'
            : 'Профиль собеседника'}
        </span>
        <button
          onClick={onClosePanel}
          className="p-1.5 text-slate-400 hover:text-slate-200 rounded-full hover:bg-slate-800/70 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 flex flex-col gap-5">
        {/* Centered Profile Hero like Telegram / Signal */}
        <div className="flex flex-col items-center text-center gap-2.5 pb-4 border-b border-slate-800/80">
          <Avatar
            src={chat.avatarUrl}
            title={chat.title}
            type={chat.type}
            status={chat.type === 'direct' ? 'online' : undefined}
            size="xl"
          />
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              {chat.title}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {chat.type === 'channel'
                ? `${chat.subscriberCount} подписчиков`
                : chat.type === 'group'
                ? `${roomMembers.length} участников`
                : 'в сети'}
            </p>
          </div>

          {/* Quick Action Buttons Row */}
          <div className="grid grid-cols-3 gap-2 w-full mt-2">
            <button
              onClick={() => onStartCall('audio')}
              className="py-2 px-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 text-slate-200 flex flex-col items-center gap-1 text-xs transition-colors"
            >
              <Phone className="w-4 h-4 text-sky-400" />
              <span>Звонок</span>
            </button>
            <button
              onClick={() => onStartCall('video')}
              className="py-2 px-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 text-slate-200 flex flex-col items-center gap-1 text-xs transition-colors"
            >
              <Video className="w-4 h-4 text-sky-400" />
              <span>Видео</span>
            </button>
            <button
              onClick={onToggleNotifications}
              className="py-2 px-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 text-slate-200 flex flex-col items-center gap-1 text-xs transition-colors"
            >
              {notificationsEnabled ? (
                <>
                  <Bell className="w-4 h-4 text-emerald-400" />
                  <span>Звук вкл</span>
                </>
              ) : (
                <>
                  <BellOff className="w-4 h-4 text-slate-400" />
                  <span>Без звука</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Handle & Description */}
        <div className="flex flex-col gap-3 pb-4 border-b border-slate-800/80 text-xs">
          {chat.handle && (
            <div>
              <div className="text-slate-400">Ссылка / юзернейм</div>
              <div className="text-sky-400 font-medium mt-0.5">
                @{chat.handle}
              </div>
            </div>
          )}
          <div>
            <div className="text-slate-400">Описание</div>
            <div className="text-slate-200 mt-0.5 leading-relaxed">
              {chat.description}
            </div>
          </div>
        </div>

        {/* Shared Files Section */}
        <div className="pb-4 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-slate-300">
              Общие файлы ({sharedFiles.length})
            </span>
          </div>
          {sharedFiles.length === 0 ? (
            <p className="text-xs text-slate-500">Нет отправленных файлов</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sharedFiles.map((m) => {
                const att = m.attachment!;
                return (
                  <div
                    key={att.id}
                    className="p-2.5 rounded-xl bg-[#0E1621] border border-slate-800/70 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-400 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate">
                          {att.name}
                        </div>
                        <div className="text-[11px] text-slate-400 tabular-nums">
                          {formatBytes(att.size)}
                        </div>
                      </div>
                    </div>
                    <a
                      href={att.dataUrl}
                      download={att.name}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0"
                      title="Скачать файл"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Room Participants */}
        <div className="pb-4 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              <span>
                {chat.type === 'channel'
                  ? `Подписчики (${chat.subscriberCount})`
                  : `Участники (${roomMembers.length})`}
              </span>
            </span>
          </div>
          <div className="flex flex-col gap-2.5">
            {roomMembers.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar
                    src={u.avatarUrl}
                    title={u.displayName}
                    status={u.status}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-200 truncate">
                      {u.displayName}
                    </div>
                    <div className="text-[11px] text-emerald-400 truncate">
                      в сети
                    </div>
                  </div>
                </div>
                {chat.adminIds.includes(u.id) && (
                  <span className="text-[11px] text-sky-400">админ</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Connected Bots */}
        <div className="pb-4 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5 text-sky-400" />
              <span>Подключенные боты ({roomBots.length})</span>
            </span>
            <button
              onClick={onOpenBotDrawer}
              className="text-xs text-sky-400 hover:underline"
            >
              Управление
            </button>
          </div>
          {roomBots.length === 0 ? (
            <p className="text-xs text-slate-500">Нет активных ботов в чате</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {roomBots.map((b) => (
                <div
                  key={b.id}
                  className="px-3 py-2 rounded-xl bg-[#0E1621] flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-medium text-slate-200">
                      {b.name}
                    </div>
                    <div className="text-[11px] text-sky-400">@{b.handle}</div>
                  </div>
                  <span className="text-[11px] text-slate-400">бот</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Collapsible E2EE Security Section */}
        <div>
          <button
            onClick={() => setShowCryptoDetails(!showCryptoDetails)}
            className="w-full flex items-center justify-between text-xs font-medium text-slate-300 hover:text-slate-100 py-1"
          >
            <span className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              <span>Сквозное шифрование (E2EE)</span>
            </span>
            {showCryptoDetails ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {(showCryptoDetails || inspectedMessage) && (
            <div className="mt-2.5 p-3 rounded-xl bg-[#0E1621] border border-slate-800 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Отпечаток ключа:
                </span>
                <button
                  onClick={onRotateRoomKeys}
                  className="text-[11px] text-sky-400 hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Обновить ключ</span>
                </button>
              </div>
              <div className="p-2 rounded bg-slate-950 font-mono text-[11px] text-emerald-300 tabular-nums">
                {chat.e2eeFingerprint}
              </div>

              {inspectedMessage && (
                <div className="pt-2 border-t border-slate-800 text-[11px] font-mono text-slate-400 space-y-1">
                  <div className="flex items-center justify-between text-sky-400">
                    <span>Пакет #{inspectedMessage.id.slice(-5)}</span>
                    <button
                      onClick={onClearInspectedMessage}
                      className="text-slate-400 hover:text-white"
                    >
                      Скрыть
                    </button>
                  </div>
                  <div>IV: {inspectedMessage.e2ee.ivHex}</div>
                  <div className="truncate">
                    SHA: {inspectedMessage.e2ee.sha256Signature}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
