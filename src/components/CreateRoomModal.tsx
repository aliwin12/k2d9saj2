import React, { useState } from 'react';
import { Users, Radio, MessageSquareLock, X } from 'lucide-react';
import { BotApp, ChatRoom, ChatType, UserProfile } from '../types';
import { formatFingerprint } from '../utils/crypto';

interface CreateRoomModalProps {
  initialType?: ChatType;
  currentUser: UserProfile;
  users: UserProfile[];
  bots: BotApp[];
  onClose: () => void;
  onCreateRoom: (room: ChatRoom) => void;
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  initialType = 'group',
  currentUser,
  users,
  bots,
  onClose,
  onCreateRoom,
}) => {
  const [type, setType] = useState<ChatType>(initialType);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(
    users.map((u) => u.id)
  );
  const [selectedBots, setSelectedBots] = useState<string[]>(
    bots[0] ? [bots[0].id] : []
  );

  const toggleMember = (id: string) => {
    if (id === currentUser.id) return;
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const toggleBot = (id: string) => {
    setSelectedBots((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const seed = `room-seed-${type}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const fp = await formatFingerprint(seed);

    const newRoom: ChatRoom = {
      id: `chat_${type}_${Date.now()}`,
      type,
      title: title.trim(),
      handle:
        handle.trim().replace(/^@/, '').toLowerCase() ||
        `cc_${type}_${Math.floor(1000 + Math.random() * 9000)}`,
      description:
        description.trim() ||
        (type === 'channel'
          ? 'Информационный канал'
          : type === 'group'
          ? 'Групповой чат'
          : 'Личный чат'),
      memberIds: Array.from(new Set([currentUser.id, ...selectedMembers])),
      adminIds: [currentUser.id],
      botIds: selectedBots,
      e2eeKeySeed: seed,
      e2eeFingerprint: fp,
      createdAt: new Date().toISOString(),
      subscriberCount:
        type === 'channel'
          ? Math.max(1, selectedMembers.length)
          : selectedMembers.length,
    };

    onCreateRoom(newRoom);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0B0F17] border border-slate-800 rounded-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#111827]">
          <h2 className="text-base font-semibold text-slate-100">
            Создать чат, группу или канал
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {/* Room Type Selector */}
          <div className="grid grid-cols-3 gap-2 p-1 bg-slate-900 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setType('direct')}
              className={`py-2 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                type === 'direct'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquareLock className="w-3.5 h-3.5" />
              <span>Личный чат</span>
            </button>
            <button
              type="button"
              onClick={() => setType('group')}
              className={`py-2 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                type === 'group'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Группа</span>
            </button>
            <button
              type="button"
              onClick={() => setType('channel')}
              className={`py-2 px-3 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                type === 'channel'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Канал</span>
            </button>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {type === 'channel'
                ? 'Название канала'
                : type === 'group'
                ? 'Название группы'
                : 'Название чата'}
            </label>
            <input
              type="text"
              required
              placeholder={
                type === 'channel'
                  ? 'Например, Новости проекта'
                  : 'Например, Команда разработки'
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Короткая ссылка (@handle)
            </label>
            <input
              type="text"
              placeholder="@username"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Описание
            </label>
            <input
              type="text"
              placeholder="Краткое описание (необязательно)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Select Participants */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Участники ({selectedMembers.length})
            </label>
            <div className="flex flex-wrap gap-2">
              {users.map((u) => {
                const checked = selectedMembers.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleMember(u.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      checked
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {u.displayName} {u.id === currentUser.id && '(Вы)'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Attach Bots */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Подключить ботов Open API
            </label>
            <div className="flex flex-wrap gap-2">
              {bots.map((b) => {
                const checked = selectedBots.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggleBot(b.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                      checked
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    @{b.handle}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold"
            >
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
