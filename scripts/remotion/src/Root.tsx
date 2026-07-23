import { Composition } from "remotion";
import { SampleComposition } from "./SampleComposition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Sample"
      component={SampleComposition}
      durationInFrames={150}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
