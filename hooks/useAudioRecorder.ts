
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useChatMessages } from './useChatMessages';

export function useAudioRecorder(
  chatId: string | null,
  otherId: string,
  secretMode: boolean,
  handleSendMessage: (messageData: Partial<any>, isSecret: boolean) => Promise<void>
) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [sendingAudio, setSendingAudio] = useState(false);

  const startRecording = async () => {
    try {
      if (!chatId) {
        Alert.alert('Errore', 'Chat non disponibile per l\'invio audio.');
        return;
      }

      const existing = await Audio.getPermissionsAsync();
      const perm = existing.granted ? existing : await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permesso negato', 'Concedi accesso al microfono per inviare un audio.');
        return;
      }

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
      await recording.startAsync();
      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording) {
          setRecordingDuration(status.durationMillis ?? 0);
        }
      });
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingPaused(false);
      setRecordingDuration(0);
    } catch (e) {
      recordingRef.current = null;
      setIsRecording(false);
      Alert.alert('Errore', 'Non sono riuscito ad avviare la registrazione.');
    }
  };

  const stopRecordingAndSend = async () => {
    const active = recordingRef.current;
    if (!active || !chatId) return;
    setSendingAudio(true);
    try {
      await active.stopAndUnloadAsync();
      const status = await active.getStatusAsync();
      const uri = active.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      const duration = status && 'durationMillis' in status ? status.durationMillis ?? 0 : 0;
      const base64 = uri
        ? await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any })
        : null;
      if (!uri || !base64) {
        throw new Error('Audio non valido');
      }
      const dataUrl = `data:audio/m4a;base64,${base64}`;
      
      await handleSendMessage(
        {
          audio: dataUrl,
          audioDuration: duration || recordingDuration,
        },
        secretMode
      );
    } catch (e) {
      Alert.alert('Errore', 'Non sono riuscito a inviare il messaggio audio.');
    } finally {
      setSendingAudio(false);
      setRecordingDuration(0);
      recordingRef.current = null;
      setIsRecording(false);
      setRecordingPaused(false);
    }
  };

  const handleRecordAudio = async () => {
    if (sendingAudio) return;
    if (isRecording) {
      await stopRecordingAndSend();
    } else {
      await startRecording();
    }
  };

  const pauseRecording = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      await rec.pauseAsync();
      setRecordingPaused(true);
    } catch {}
  };

  const resumeRecording = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      await rec.startAsync();
      setRecordingPaused(false);
    } catch {}
  };

  const cancelRecording = async () => {
    const rec = recordingRef.current;
    try {
      if (rec) {
        await rec.stopAndUnloadAsync();
      }
    } catch {}
    recordingRef.current = null;
    setIsRecording(false);
    setRecordingPaused(false);
    setRecordingDuration(0);
  };

  return {
    isRecording,
    recordingPaused,
    recordingDuration,
    sendingAudio,
    handleRecordAudio,
    pauseRecording,
    resumeRecording,
    cancelRecording,
  };
}
