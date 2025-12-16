import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

import { db } from '@/lib/firebase';

type Profile = {
  id: string;
  name: string;
  age: number;
  city: string;
  distanceKm: number;
  photo: string;
  interests: string[];
  bio?: string;
  jobTitle?: string;
};

export function useProfile(profileId?: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(!!profileId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'profiles', profileId));
        if (!active) return;
        if (snap.exists()) {
          setProfile({ id: snap.id, ...(snap.data() as any) });
        } else {
          setProfile(null);
        }
      } catch (e) {
        if (!active) return;
        setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [profileId]);

  return { profile, loading, error };
}
