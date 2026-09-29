import React, { useState } from 'react';
import {
  X,
  Users,
  Megaphone,
  MessageSquareLock,
  Plus,
  UserPlus,
} from 'lucide-react';
import { BotApp, ChatRoom, ChatType, UserProfile } from '../types';
import { formatFingerprint } from '../utils/crypto';

interface CreateRoomModalProps {
  currentUser: UserProfile;
  users: UserProfile[];
  bots: BotApp[];
  initialType?: ChatType;
  onCreateRoom: (room: ChatRoom) => void;
  onClose: () => void;
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  currentUser,
  users,
  bots,
  initialType = 'group',
  onCreateRoom,
  onClose,
}) => {
  const [type, setType] = useState<ChatType>(initialType);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([
    currentUser.id,
  ]);
  const [selectedBots, setSelectedBots] = useState<string[]>([]);
  const [memberLookupInput, setMemberLookupInput] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);

  const myBots = bots.filter((b) => b.ownerId === currentUser.id);

  const handleAddMemberByQuery = () => {
    setLookupError(null);
    const q = memberLookupInput.trim().toLowerCase().replace(/^@/, '');
    if (!q) return;

    const found = users.find(
      (u) =>
        u.handle.toLowerCase() === q ||
        (u.email && u.email.toLowerCase() === q)
    );

    if (!found) {
      setLookupError('Пользователь с таким @username или Email не найден.');
      return;
    }

    if (!selectedMembers.includes(found.id)) {
      setSelectedMembers((prev) => [...prev, found.id]);
    }
    setMemberLookupInput('');
  };

  const removeMember = (id: string) => {
    if (id === currentUser.id) return;
    setSelectedMembers((prev) => prev.filter((x) => x !== id));
  };

  const toggleBot = (id: string) => {
    setSelectedBots((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const seed = `room-seed-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const fp = await formatFingerprint(seed);
    const cleanHandle =
      handle
        .replace(/^@/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_') || `room_${Date.now().toString().slice(-4)}`;

    const newRoom: ChatRoom = {
      id: `chat_${Date.now()}`,
      type,
      title: title.trim(),
      handle: cleanHandle,
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
        type === 'channel' ? Math.max(1, selectedMembers.length) : selectedMembers.length,
    };

    onCreateRoom(newRoom);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0F1623] border border-slate-800 rounded-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#131C2B]">
          <div className="flex items-center gap-2.5">
            <Plus className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Создать чат, группу или канал
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Room Type Switcher */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setType('direct')}
              className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-colors ${
                type === 'direct'
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquareLock className="w-4 h-4" />
              <span>Личный чат</span>
            </button>
            <button
              type="button"
              onClick={() => setType('group')}
              className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-colors ${
                type === 'group'
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Группа</span>
            </button>
            <button
              type="button"
              onClick={() => setType('channel')}
              className={`p-2.5 rounded-lg border text-xs font-medium flex flex-col items-center gap-1.5 transition-colors ${
                type === 'channel'
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Megaphone className="w-4 h-4" />
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
                  : 'Например, Рабочая группа'
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

          {/* Add Participants by @username or Email */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">
              Добавить участников по @username или Email
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="@username или email..."
                value={memberLookupInput}
                onChange={(e) => setMemberLookupInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMemberByQuery();
                  }
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={handleAddMemberByQuery}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Добавить</span>
              </button>
            </div>
            {lookupError && (
              <p className="text-[11px] text-red-400 mt-1">{lookupError}</p>
            )}

            <div className="flex flex-wrap gap-2 mt-2.5">
              {selectedMembers.map((memberId) => {
                const u =
                  users.find((x) => x.id === memberId) ||
                  (memberId === currentUser.id ? currentUser : null);
                if (!u) return null;
                const isMe = u.id === currentUser.id;
                return (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-200"
                  >
                    <span>
                      {u.displayName} {isMe ? '(Вы)' : `(@${u.handle})`}
                    </span>
                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => removeMember(u.id)}
                        className="text-emerald-300 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Attach Own Bots */}
          {myBots.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">
                Подключить моих ботов
              </label>
              <div className="flex flex-wrap gap-2">
                {myBots.map((b) => {
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
          )}

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
