import { exportToCanvas } from "@excalidraw/utils";
import { getNonDeletedElements } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_HEIGHT = 200;

export const generateThumbnail = async (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): Promise<string> => {
  const nonDeleted = getNonDeletedElements(elements);
  if (nonDeleted.length === 0) {
    return "";
  }

  const canvas = await exportToCanvas({
    elements: nonDeleted,
    appState: {
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
    },
    files,
    maxWidthOrHeight: THUMBNAIL_WIDTH,
    getDimensions: (width, height) => {
      const scale = Math.min(
        THUMBNAIL_WIDTH / width,
        THUMBNAIL_HEIGHT / height,
        1,
      );
      return {
        width: width * scale,
        height: height * scale,
        scale,
      };
    },
  });

  return canvas.toDataURL("image/png", 0.5);
};
