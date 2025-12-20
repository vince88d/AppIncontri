import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  Platform,
} from 'react-native';
import { doc, setDoc } from 'firebase/firestore';

import { Colors } from '@/constants/theme';
import { auth, db } from '@/lib/firebase';
import { useAuth } from '@/hooks/use-auth';
import { uploadImageToStorage } from '@/lib/storage';

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';

export default function ProfileSetupScreen() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [city, setCity] = useState('');
  const [photos, setPhotos] = useState<string[]>([FALLBACK_PHOTO]);
  const [bio, setBio] = useState('');

  const uploadProfilePhotos = async () => {
    if (!user) return { urls: [FALLBACK_PHOTO], meta: [] };
    const selected = photos.filter((uri) => uri && uri !== FALLBACK_PHOTO);
    if (!selected.length) {
      return { urls: [FALLBACK_PHOTO], meta: [] };
    }

    const uploads = [];
    for (let i = 0; i < selected.length; i += 1) {
      const uri = selected[i];
      if (uri.startsWith('http')) {
        uploads.push({ url: uri, path: '' });
        continue;
      }
      const path = `profile-images/${user.uid}/${Date.now()}-${i}`;
      const { url, path: storedPath } = await uploadImageToStorage({
        uri,
        path,
        metadata: {
          kind: 'profile',
          profileId: user.uid,
          photoIndex: String(i),
        },
      });
      uploads.push({ url, path: storedPath });
    }

    const urls = uploads.map((item) => item.url);
    const meta = uploads.map((item) =>
      item.path
        ? { path: item.path, moderationStatus: 'pending', contentWarning: null }
        : {}
    );
    return { urls, meta };
  };

  useEffect(() => {
    if (!user) {
      router.replace('/auth');
    }
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    const ageNum = Number(age);
    if (!name.trim() || Number.isNaN(ageNum) || ageNum < 18) {
      Alert.alert('Controlla i campi', 'Inserisci nome e una età valida (>=18).');
      return;
    }
    setLoading(true);
    try {
      const { urls, meta } = await uploadProfilePhotos();
      await setDoc(doc(db, 'profiles', user.uid), {
        name: name.trim(),
        age: ageNum,
        city: city.trim() || 'N/D',
        distanceKm: 0, // calcoleremo via GPS più avanti
        photo: urls[0] ?? FALLBACK_PHOTO,
        photos: urls.length ? urls : [FALLBACK_PHOTO],
        photoMeta: meta,
        interests: [],
        bio: bio.trim(),
        jobTitle: '',
      });
      router.replace('/');
    } catch (e) {
      Alert.alert('Errore', 'Salvataggio non riuscito. Riprova.');
    } finally {
      setLoading(false);
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permesso negato', 'Concedi accesso alle foto per scegliere un immagine.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 3,
      base64: Platform.OS === 'web',
    });
    if (!result.canceled) {
      const uris = result.assets.map((a) => {
        if (Platform.OS === 'web' && a.base64) {
          const mime = a.type ?? 'image/jpeg';
          return `data:${mime};base64,${a.base64}`;
        }
        return a.uri;
      });
      setPhotos(uris.length ? uris : [FALLBACK_PHOTO]);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Crea il tuo profilo</Text>
        <Text style={[styles.subtitle, { color: palette.muted }]}>
          Inserisci le info base per iniziare. Potrai modificarle in seguito.
        </Text>

        <View style={[styles.field, { borderColor: palette.border }]}>
          <TextInput
            placeholder="Nome / Nickname"
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholderTextColor={palette.muted}
          />
        </View>
        <View style={[styles.field, { borderColor: palette.border }]}>
          <TextInput
            placeholder="Età (>=18)"
            value={age}
            onChangeText={setAge}
            keyboardType="numeric"
            style={styles.input}
            placeholderTextColor={palette.muted}
          />
        </View>
        <View style={[styles.field, { borderColor: palette.border }]}>
          <TextInput
            placeholder="Città"
            value={city}
            onChangeText={setCity}
            style={styles.input}
            placeholderTextColor={palette.muted}
          />
        </View>
        <View style={[styles.field, { borderColor: palette.border }]}>
          <View style={styles.photosRow}>
            <Text style={styles.fieldLabel}>Foto profilo</Text>
            <Pressable style={[styles.secondary, { borderColor: palette.border }]} onPress={handlePickImage}>
              <Text style={styles.secondaryText}>Scegli dalla galleria</Text>
            </Pressable>
          </View>
          {photos.length > 0 ? (
            <ScrollView horizontal contentContainerStyle={styles.previewRow} showsHorizontalScrollIndicator={false}>
              {photos.map((uri) => (
                <Image key={uri} source={{ uri }} style={styles.preview} />
              ))}
            </ScrollView>
          ) : (
            <Text style={[styles.placeholder, { color: palette.muted }]}>
              Nessuna foto selezionata
            </Text>
          )}
        </View>
        <View style={[styles.field, styles.bioField, { borderColor: palette.border }]}>
          <TextInput
            placeholder="Bio (facoltativa)"
            value={bio}
            onChangeText={setBio}
            style={[styles.input, { height: 80 }]}
            multiline
            placeholderTextColor={palette.muted}
          />
        </View>

        <Pressable
          style={[styles.primary, { backgroundColor: palette.tint }]}
          onPress={handleSave}
          disabled={loading}>
          <Text style={styles.primaryText}>{loading ? 'Salvo...' : 'Salva profilo'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 6,
  },
  field: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bioField: {
    paddingVertical: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  photosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  previewRow: {
    gap: 10,
  },
  preview: {
    width: 90,
    height: 120,
    borderRadius: 10,
  },
  placeholder: {
    fontSize: 13,
  },
  input: {
    fontSize: 15,
  },
  primary: {
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondary: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
