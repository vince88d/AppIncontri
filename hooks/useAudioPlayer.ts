
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

type ChatMessage = {
    id: string;
    text?: string;
    senderId: string;
    createdAt?: any;
    image?: string;
    audio?: string;
    audioDuration?: number;
    expiresAfterView?: boolean;
    expiresAt?: any;
    location?: {
      lat: number;
      lng: number;
    };
  };

export function useAudioPlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<Audio.AVPlaybackStatus | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const audioCacheRef = useRef<Record<string, string>>({});
  const base64Encoding = (FileSystem as any).EncodingType?.Base64 || 'base64';


  const prepareAudioUri = async (audio: string | undefined, id: string) => {
    if (!audio) return null;
    if (audio.startsWith('http')) return audio;
    if (audio.startsWith('data:audio')) {
      if (audioCacheRef.current[id]) return audioCacheRef.current[id];
      const base64 = audio.split(',')[1] ?? audio;
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!cacheDir) return null;
      const fileUri = `${cacheDir}chat-audio-${id}.m4a`;
      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: base64Encoding as any,
      });
      audioCacheRef.current[id] = fileUri;
      return fileUri;
    }
    return audio;
  };

  const handlePlayAudio = async (item: ChatMessage) => {
    if (!item.audio) return;
    try {
      const uri = await prepareAudioUri(item.audio, item.id);
      if (!uri) return;

      if (playingId === item.id && soundRef.current) {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded && status.isPlaying) {
          await soundRef.current.pauseAsync();
        } else {
          await soundRef.current.playAsync();
        }
        return;
      }

      if (soundRef.current) {
        try {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
        } catch {} // Ignore errors during stop/unload
        soundRef.current = null;
      }

      setPlaybackStatus(null);

      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        setPlaybackStatus(status);
        if (status.didJustFinish) {
          setPlayingId(null);
          setPlaybackStatus(null);
        }
      });
      soundRef.current = sound;
      setPlayingId(item.id);
    } catch (e) {
      setPlayingId(null);
      setPlaybackStatus(null);
      Alert.alert('Errore', 'Non sono riuscito a riprodurre l\'audio.');
    }
  };

  return {
    playingId,
    playbackStatus,
    handlePlayAudio,
    soundRef,
  };
}
