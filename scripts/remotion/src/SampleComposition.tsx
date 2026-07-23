import { AbsoluteFill, useCurrentFrame } from "remotion";

export const SampleComposition: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b0b0f",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ color: "white", fontSize: 64, fontFamily: "sans-serif" }}>
        Frame {frame}
      </div>
    </AbsoluteFill>
  );
};
