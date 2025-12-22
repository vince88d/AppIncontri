import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

// Componente ParticleEffect semplificato
export const ParticleEffect = React.memo(
  ({ visible, color }: { visible: boolean; color: string }) => {
    const particles = useMemo(
      () =>
        Array.from({ length: 12 }).map(() => ({
          anim: new Animated.Value(0),
          angle: Math.random() * 360,
          distance: 30 + Math.random() * 60,
          size: 2 + Math.random() * 4,
          delay: Math.random() * 120,
        })),
      []
    );

    const [showParticles, setShowParticles] = useState(false);

    useEffect(() => {
      if (visible) {
        setShowParticles(true);
        const animations = particles.map((p, i) =>
          Animated.timing(p.anim, {
            toValue: 1,
            duration: 900,
            delay: p.delay + i * 15,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })
        );
        Animated.parallel(animations).start(() => {
          setShowParticles(false);
          particles.forEach((p) => p.anim.setValue(0));
        });
      } else {
        setShowParticles(false);
        particles.forEach((p) => p.anim.setValue(0));
      }
    }, [visible, particles]);

    if (!showParticles) return null;

    return (
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
        {particles.map((p, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: color,
              left: '50%',
              top: '50%',
              opacity: p.anim.interpolate({
                inputRange: [0, 0.3, 0.7, 1],
                outputRange: [1, 0.8, 0.4, 0],
              }),
              transform: [
                {
                  translateX: p.anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.cos((p.angle * Math.PI) / 180) * p.distance],
                  }),
                },
                {
                  translateY: p.anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.sin((p.angle * Math.PI) / 180) * p.distance],
                  }),
                },
                {
                  scale: p.anim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [1, 1.05, 0.2],
                  }),
                },
                {
                  rotate: p.anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${Math.random() * 30 - 15}deg`],
                  }),
                },
              ],
            }}
          />
        ))}
      </View>
    );
  }
);
