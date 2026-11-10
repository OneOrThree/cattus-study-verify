import {
  StudyVerifyCamera,
  createVerifiedTimeTracker,
  type StudyObjectPresence,
  type VerificationDetection,
} from 'cattus-study-verify';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';

const GUIDANCE: Record<VerificationDetection, string> = {
  checking: 'Checking. The decision needs three frames.',
  focused: 'Verified: a hand and a book, laptop or keyboard are in the same frame.',
  missingHand: 'No hand found. Put a hand in view.',
  missingObject: 'A hand is in view, but no book, laptop or keyboard.',
  unavailable: 'A model or the camera failed, so no decision can be made.',
};

export default function App() {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState<'front' | 'back'>('front');
  const [detection, setDetection] = useState<VerificationDetection>('checking');
  const [objects, setObjects] = useState<StudyObjectPresence | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const tracker = useRef(createVerifiedTimeTracker());

  const onDetection = useCallback((next: VerificationDetection) => {
    setDetection(next);
    // Live cadence: a gap of 2 seconds or more between positive results is not counted.
    setSeconds(tracker.current.observe(next === 'focused'));
  }, []);
  const onPaused = useCallback(() => {
    tracker.current.pause();
    setCameraReady(false);
  }, []);
  const onReady = useCallback(() => setCameraReady(true), []);
  const onError = useCallback((error: unknown) => console.warn('camera error', error), []);

  // Between detections the count must still show the latest total, so poll it.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setSeconds(Math.floor(tracker.current.verifiedMs() / 1000)),
      500
    );
    return () => clearInterval(timer);
  }, [running]);

  const start = () => {
    tracker.current = createVerifiedTimeTracker();
    setSeconds(0);
    setDetection('checking');
    setObjects(null);
    setRunning(true);
  };
  const stop = () => {
    tracker.current.close();
    setRunning(false);
    setCameraReady(false);
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>cattus-study-verify</Text>

        <View style={styles.preview}>
          <StudyVerifyCamera
            position={position}
            active={running && hasPermission}
            cadence="live"
            onReady={onReady}
            onPaused={onPaused}
            onDetection={onDetection}
            onStudyObjects={setObjects}
            onError={onError}
          />
          {!running && <Text style={styles.placeholder}>Camera is off</Text>}
        </View>

        {!hasPermission && (
          <Button
            title={canRequestPermission ? 'Allow camera' : 'Camera is off in Settings'}
            disabled={!canRequestPermission}
            onPress={() => void requestPermission()}
          />
        )}
        {hasPermission && (
          <View style={styles.row}>
            <Button title={running ? 'Stop' : 'Start'} onPress={running ? stop : start} />
            <Button
              title={`Camera: ${position}`}
              disabled={running}
              onPress={() => setPosition(position === 'front' ? 'back' : 'front')}
            />
          </View>
        )}

        <Section title="Detection">
          <Text style={styles.value}>{running ? detection : '-'}</Text>
          <Text style={styles.note}>{running ? GUIDANCE[detection] : 'Press Start.'}</Text>
          <Text style={styles.note}>Frames arriving: {running && cameraReady ? 'yes' : 'no'}</Text>
        </Section>

        <Section title="Objects in at least 2 of the last 3 frames">
          <Text style={styles.value}>
            {objects
              ? `book ${flag(objects.book)}, laptop ${flag(objects.laptop)}, keyboard ${flag(objects.keyboard)}`
              : '-'}
          </Text>
        </Section>

        <Section title="Verified time">
          <Text style={styles.value}>{seconds} s</Text>
          <Text style={styles.note}>
            From createVerifiedTimeTracker(). It adds the time between two positive results that are
            less than 2 seconds apart.
          </Text>
        </Section>

        <Text style={styles.note}>
          Frames are processed on this device. No photo or video is saved and nothing is sent.
          Detection accuracy, battery use and heat have not been measured.
        </Text>
      </ScrollView>
    </View>
  );
}

const flag = (value: boolean) => (value ? 'yes' : 'no');

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f4f6' },
  content: { padding: 16, paddingTop: 64, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  preview: {
    height: 280,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { color: '#bbb' },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 12, gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#555' },
  value: { fontSize: 16, fontWeight: '600' },
  note: { fontSize: 13, color: '#555' },
});
