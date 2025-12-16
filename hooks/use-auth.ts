import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';

import { auth } from '@/lib/firebase';

export function useAuth() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sub = onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
    });
    return sub;
  }, []);

  return { user, loading };
}
