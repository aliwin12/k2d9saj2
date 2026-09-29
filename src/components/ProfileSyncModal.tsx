import React, { useRef, useState } from 'react';
import {
  User,
  Smartphone,
  Laptop,
  Copy,
  Check,
  LogOut,
  X,
  Trash2,
  Link2,
  Camera,
  Palette,
} from 'lucide-react';
import { DeviceSession, UserProfile } from '../types';
import { Avatar } from './Avatar';

interface ProfileSyncModalProps {
  currentUser: UserProfile;
  userEmail?: string;
  allUsers: UserProfile[];
  devices: DeviceSession[];
  onClose: () => void;
  onUpdateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  onLinkDeviceByCode: (
    syncCode: string,
    deviceName: string
  ) => Promise<string | null>;
  onRevokeDevice: (deviceId: string) => void;
  onSignOut: () => void;
}

const ACCENT_PRESETS = [
  { id: 'sky', label: 'Небесный', gradient: 'from-sky-500 to-blue-600' },
  {
    id: 'emerald',
    label: 'Изумрудный',
    gradient: 'from-emerald-500 to-teal-600',
  },
  {
    id: 'violet',
    label: 'Фиолетовый',
    gradient: 'from-violet-500 to-purple-600',
  },
  { id: 'rose', label: 'Розовый', gradient: 'from-rose-500 to-pink-600' },
  { id: 'amber', label: 'Янтарный', gradient: 'from-amber-500 to-orange-600' },
  { id: 'indigo', label: 'Индиго', gradient: 'from-indigo-500 to-blue-700' },
];

export const ProfileSyncModal: React.FC<ProfileSyncModalProps> = ({
  currentUser,
  userEmail,
  devices,
  onClose,
  onUpdateProfile,
  onLinkDeviceByCode,
  onRevokeDevice,
  onSignOut,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'sync'>('profile');

  // Profile customization state
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [handle, setHandle] = useState(currentUser.handle);
  const [bio, setBio] = useState(currentUser.bio);
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || '');
  const [status, setStatus] = useState<'online' | 'away' | 'offline'>(
    currentUser.status || 'online'
  );
  const [accentColor, setAccentColor] = useState(
    currentUser.accentColor || 'sky'
  );
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedSync, setCopiedSync] = useState(false);

  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  // Link device state
  const [inputSyncCode, setInputSyncCode] = useState('');
  const [inputDeviceName, setInputDeviceName] = useState(
    'ClickChat Browser #2'
  );
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const userDevices = devices.filter((d) => d.userId === currentUser.id);

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 256;
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > maxSize) {
            h = Math.round((h * maxSize) / w);
            w = maxSize;
          }
        } else {
          if (h > maxSize) {
            w = Math.round((w * maxSize) / h);
            h = maxSize;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.86);
          setAvatarUrl(compressedDataUrl);
        } else {
          setAvatarUrl(String(reader.result || ''));
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateProfile({
      id: currentUser.id,
      displayName: displayName.trim() || currentUser.displayName,
      handle: handle.trim().replace(/^@/, '') || currentUser.handle,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),
      status,
      accentColor,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const copySyncCode = () => {
    navigator.clipboard.writeText(currentUser.syncCode);
    setCopiedSync(true);
    setTimeout(() => setCopiedSync(false), 1800);
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputSyncCode.trim()) return;
    const err = await onLinkDeviceByCode(
      inputSyncCode.trim(),
      inputDeviceName.trim()
    );
    if (err) {
      setSyncMessage(err);
    } else {
      setSyncMessage('Устройство успешно синхронизировано с вашим аккаунтом!');
      setInputSyncCode('');
    }
  };

  const selectedAccent =
    ACCENT_PRESETS.find((p) => p.id === accentColor) || ACCENT_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0B0F17] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#111827]">
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Кастомизация профиля и устройства
              </h2>
              <p className="text-xs text-slate-400">
                {userEmail ? userEmail : 'Настройки вашего профиля'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSignOut}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/70 hover:text-red-300 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition-colors"
              title="Выйти из аккаунта"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Выйти</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 py-3 bg-[#0E1420] border-b border-slate-800">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'profile'
                ? 'bg-sky-500 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200 bg-slate-900'
            }`}
          >
            Кастомизация профиля
          </button>
          <button
            onClick={() => setActiveTab('sync')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'sync'
                ? 'bg-sky-500 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200 bg-slate-900'
            }`}
          >
            Устройства ({userDevices.length})
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="flex flex-col gap-5">
              {/* Live Profile Banner & Avatar Preview */}
              <div className="rounded-2xl border border-slate-800 overflow-hidden bg-[#131C2B]">
                <div
                  className={`h-24 bg-gradient-to-r ${selectedAccent.gradient} relative`}
                />
                <div className="px-5 pb-5 -mt-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div className="flex items-end gap-4">
                    <div className="relative group">
                      <div className="rounded-full p-1 bg-[#131C2B]">
                        <Avatar
                          src={avatarUrl}
                          title={displayName || currentUser.displayName}
                          status={status}
                          size="xl"
                        />
                      </div>
                      <input
                        ref={avatarFileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarFileChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => avatarFileInputRef.current?.click()}
                        className="absolute bottom-1 right-1 w-7 h-7 rounded-full bg-sky-500 hover:bg-sky-400 text-white flex items-center justify-center shadow-lg transition-colors"
                        title="Загрузить фото"
                      >
                        <Camera className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="pb-1">
                      <div className="text-base font-bold text-white">
                        {displayName || 'Без имени'}
                      </div>
                      <div className="text-xs text-sky-400 font-mono">
                        @{handle.replace(/^@/, '') || currentUser.handle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => avatarFileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5 text-sky-400" />
                      <span>Загрузить аватар</span>
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarUrl('')}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-xs text-slate-400 hover:text-red-300 transition-colors"
                      >
                        Удалить фото
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Name & @username */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Отображаемое имя
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ваше имя"
                    className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Имя пользователя (@username)
                  </label>
                  <input
                    type="text"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="@username"
                    className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  О себе / статус
                </label>
                <input
                  type="text"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Расскажите немного о себе..."
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Online Status */}
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  Статус видимости
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    {
                      id: 'online' as const,
                      label: 'В сети',
                      dot: 'bg-emerald-400',
                    },
                    {
                      id: 'away' as const,
                      label: 'Отошел',
                      dot: 'bg-amber-400',
                    },
                    {
                      id: 'offline' as const,
                      label: 'Скрытый',
                      dot: 'bg-slate-500',
                    },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStatus(item.id)}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                        status === item.id
                          ? 'bg-sky-500/15 border-sky-500/60 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${item.dot}`} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme Accent Color */}
              <div>
                <label className="flex items-center gap-1.5 text-xs text-slate-400 mb-1.5">
                  <Palette className="w-3.5 h-3.5 text-sky-400" />
                  <span>Цвет обложки профиля</span>
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {ACCENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setAccentColor(preset.id)}
                      className={`p-2 rounded-lg border text-xs flex flex-col items-center gap-1.5 transition-all ${
                        accentColor === preset.id
                          ? 'border-white bg-slate-800 text-white font-semibold'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full bg-gradient-to-br ${preset.gradient}`}
                      />
                      <span className="text-[11px]">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold transition-colors shadow-lg shadow-sky-500/20"
                >
                  Сохранить изменения
                </button>
                {savedNotice && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    Профиль обновлен!
                  </span>
                )}
              </div>
            </form>
          )}

          {activeTab === 'sync' && (
            <div className="flex flex-col gap-6">
              {/* Sync Code Box */}
              <div className="p-4 rounded-lg bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-200">
                    Ваш код синхронизации аккаунта
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Используйте этот код для привязки второго браузера или
                    устройства
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-2 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 font-semibold">
                    {currentUser.syncCode}
                  </span>
                  <button
                    onClick={copySyncCode}
                    className="p-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                    title="Скопировать код синхронизации"
                  >
                    {copiedSync ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Link Another Account or Device by Sync Code */}
              <form
                onSubmit={handleLinkSubmit}
                className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 flex flex-col gap-3"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <Link2 className="w-4 h-4 text-sky-400" />
                  <span>Привязать устройство по коду синхронизации</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="Код (напр. CC-982A-4F10-88B2)"
                    value={inputSyncCode}
                    onChange={(e) => setInputSyncCode(e.target.value)}
                    className="px-3 py-2 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="Имя этого устройства"
                    value={inputDeviceName}
                    onChange={(e) => setInputDeviceName(e.target.value)}
                    className="px-3 py-2 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold"
                  >
                    Синхронизировать сессию
                  </button>
                  {syncMessage && (
                    <span className="text-xs text-emerald-400">
                      {syncMessage}
                    </span>
                  )}
                </div>
              </form>

              {/* Active Devices List */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  Активные сессии ({userDevices.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {userDevices.map((dev) => (
                    <div
                      key={dev.id}
                      className="flex items-center justify-between p-3.5 rounded-lg bg-slate-900 border border-slate-800"
                    >
                      <div className="flex items-center gap-3">
                        {dev.platform.toLowerCase().includes('ios') ||
                        dev.platform.toLowerCase().includes('android') ? (
                          <Smartphone className="w-5 h-5 text-sky-400" />
                        ) : (
                          <Laptop className="w-5 h-5 text-sky-400" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-100">
                              {dev.deviceName}
                            </span>
                            <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Активно
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {dev.platform}
                          </div>
                        </div>
                      </div>

                      {userDevices.length > 1 && (
                        <button
                          onClick={() => onRevokeDevice(dev.id)}
                          className="p-2 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800 transition-colors"
                          title="Завершить сессию устройства"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
