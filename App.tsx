import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { NavigationBar } from "expo-navigation-bar";
import { CANVAS_COLOR } from "@/constants";
import { useDrawing } from "@/hooks/useDrawing";
import { builtinTexture, type Texture } from "@/helpers/textures";
import { SkiaRenderer } from "@/components/SkiaRenderer";

function DrawingScene({ texture }: { texture: Texture }) {
  const { width, height } = useWindowDimensions();
  const drawing = useDrawing(width, height);
  return <SkiaRenderer drawing={drawing} texture={texture} width={width} height={height} />;
}

export default function App() {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    // Let the loading view paint before generating the texture and its mip levels.
    const task = requestIdleCallback(() => setTexture(builtinTexture()));
    return () => cancelIdleCallback(task);
  }, []);

  return (
    <View
      accessible
      accessibilityLabel={
        texture ? "Ink canvas. Tilt your phone to roll the ball and draw." : "Loading the scene…"
      }
      accessibilityState={{ busy: !texture }}
      style={{ flex: 1, backgroundColor: CANVAS_COLOR }}
    >
      <StatusBar hidden />
      <NavigationBar hidden />
      {texture ? (
        <DrawingScene texture={texture} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <ActivityIndicator size="large" color="#0000e7" />
          <Text style={{ color: "#555", fontSize: 16 }}>Loading the scene…</Text>
        </View>
      )}
    </View>
  );
}
