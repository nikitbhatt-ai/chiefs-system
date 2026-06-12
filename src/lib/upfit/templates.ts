// Vehicle template definitions for the Upfit Builder. Each body style
// defines five views (top, front, rear, side_left, side_right) with a
// shared 1000x600 viewBox. Pins are stored as fractional (x, y)
// coordinates 0..1 within whichever view they sit in, so they render
// identically at any scale — on screen, on print, and in the PDF.
//
// Templates are SVG path data only — no React, no styling — so the same
// definition feeds both the HTML editor and the React-PDF spec sheet.
// Adding a new body style: append to BODY_STYLES + VEHICLE_TEMPLATES;
// no other code needs to change.

export type ViewKey = "top" | "front" | "rear" | "side_left" | "side_right";

export const VIEW_LABELS: Record<ViewKey, string> = {
  top: "Top",
  front: "Front",
  rear: "Rear",
  side_left: "Side (Driver)",
  side_right: "Side (Passenger)",
};

export const VIEW_ORDER: ViewKey[] = ["top", "front", "rear", "side_left", "side_right"];

export type VehicleView = {
  // Background image for this view. Files live in
  // `public/upfit-templates/<slug>/<view>.png` (PNG / JPG). The editor and
  // PDF both fetch via the URL form below; missing files render as an
  // empty white panel + the SVG-path fallback below.
  imageUrl: string;
  // Optional SVG path fallback drawn behind the image when the image is
  // missing. Strokes against a 1000x600 viewBox at strokeWidth=2. Kept
  // around so the page still shows *something* recognizable when a
  // template image hasn't been uploaded yet.
  fallbackPaths: string[];
};

export type VehicleTemplate = {
  slug: string;
  label: string;
  views: Record<ViewKey, VehicleView>;
};

export const VIEW_VIEWBOX = { width: 1000, height: 600 } as const;

// --- SUV (Tahoe / Suburban silhouette) ----------------------------------
const SUV: VehicleTemplate = {
  slug: "suv",
  label: "SUV (Tahoe / Suburban / Explorer)",
  views: {
    top: {
      imageUrl: "/upfit-templates/suv/top.png",
      fallbackPaths: [
        // Body outline
        "M 250 80 L 750 80 Q 820 80 850 130 L 870 200 L 870 400 L 850 470 Q 820 520 750 520 L 250 520 Q 180 520 150 470 L 130 400 L 130 200 L 150 130 Q 180 80 250 80 Z",
        // Windshield
        "M 280 150 L 720 150 L 760 250 L 240 250 Z",
        // Roof outline
        "M 280 250 L 720 250 L 720 410 L 280 410 Z",
        // Rear window
        "M 280 410 L 720 410 L 760 470 L 240 470 Z",
        // Hood split
        "M 500 80 L 500 150",
        // Trunk split
        "M 500 470 L 500 520",
        // Side mirrors L
        "M 240 240 L 220 235 L 220 265 L 240 260 Z",
        // Side mirrors R
        "M 760 240 L 780 235 L 780 265 L 760 260 Z",
        // Wheel wells (top-down)
        "M 200 140 L 230 140 L 230 175 L 200 175 Z",
        "M 770 140 L 800 140 L 800 175 L 770 175 Z",
        "M 200 425 L 230 425 L 230 460 L 200 460 Z",
        "M 770 425 L 800 425 L 800 460 L 770 460 Z",
      ],
    },
    front: {
      imageUrl: "/upfit-templates/suv/front.png",
      fallbackPaths: [
        // Body
        "M 200 200 L 800 200 L 820 350 L 850 360 L 850 480 L 800 500 L 200 500 L 150 480 L 150 360 L 180 350 Z",
        // Hood / windshield
        "M 250 200 L 750 200 L 770 130 L 230 130 Z",
        // Roof
        "M 280 130 L 720 130 L 720 80 L 280 80 Z",
        // Grille
        "M 350 320 L 650 320 L 650 400 L 350 400 Z",
        "M 350 340 L 650 340",
        "M 350 360 L 650 360",
        "M 350 380 L 650 380",
        // Headlights L
        "M 200 240 L 330 240 L 340 310 L 200 310 Z",
        // Headlights R
        "M 800 240 L 670 240 L 660 310 L 800 310 Z",
        // Windshield wipers
        "M 380 190 L 420 150",
        "M 580 190 L 620 150",
        // Front bumper
        "M 150 460 L 850 460",
      ],
    },
    rear: {
      imageUrl: "/upfit-templates/suv/rear.png",
      fallbackPaths: [
        // Body
        "M 200 200 L 800 200 L 820 350 L 850 360 L 850 480 L 800 500 L 200 500 L 150 480 L 150 360 L 180 350 Z",
        // Rear window
        "M 250 200 L 750 200 L 770 130 L 230 130 Z",
        // Roof
        "M 280 130 L 720 130 L 720 80 L 280 80 Z",
        // Tailgate
        "M 280 260 L 720 260 L 720 420 L 280 420 Z",
        // License plate area
        "M 430 340 L 570 340 L 570 390 L 430 390 Z",
        // Tail lights L
        "M 200 240 L 280 240 L 280 320 L 200 320 Z",
        // Tail lights R
        "M 800 240 L 720 240 L 720 320 L 800 320 Z",
        // CHMSL (third brake light)
        "M 440 110 L 560 110 L 560 125 L 440 125 Z",
        // Exhaust
        "M 720 470 L 760 470",
        "M 240 470 L 280 470",
      ],
    },
    side_left: {
      imageUrl: "/upfit-templates/suv/side_left.png",
      fallbackPaths: [
        // Body
        "M 100 280 Q 130 220 200 200 L 330 180 L 360 140 L 700 140 L 740 180 L 870 200 Q 920 230 920 290 L 920 420 L 100 420 Z",
        // Greenhouse split
        "M 360 140 L 380 280 L 720 280 L 700 140",
        // Door A
        "M 380 280 L 400 200 L 400 420",
        // Door B
        "M 530 200 L 530 420",
        // Door C (rear quarter)
        "M 700 200 L 700 420",
        // Door handles
        "M 460 320 L 510 320 L 510 335 L 460 335 Z",
        "M 600 320 L 650 320 L 650 335 L 600 335 Z",
        // Window seams
        "M 400 180 L 530 180 L 530 280",
        "M 530 180 L 700 180 L 700 280",
        // Wheel wells
        "M 240 420 Q 240 360 290 360 Q 340 360 340 420",
        "M 720 420 Q 720 360 770 360 Q 820 360 820 420",
        // Wheels (visible portion)
        "M 240 420 L 240 470 L 340 470 L 340 420",
        "M 720 420 L 720 470 L 820 470 L 820 420",
        // Side mirror
        "M 360 200 L 340 180 L 320 200",
        // Rocker / lower body
        "M 100 420 L 920 420",
      ],
    },
    side_right: {
      imageUrl: "/upfit-templates/suv/side_right.png",
      fallbackPaths: [
        // (Mirror of side_left)
        "M 900 280 Q 870 220 800 200 L 670 180 L 640 140 L 300 140 L 260 180 L 130 200 Q 80 230 80 290 L 80 420 L 900 420 Z",
        "M 640 140 L 620 280 L 280 280 L 300 140",
        "M 620 280 L 600 200 L 600 420",
        "M 470 200 L 470 420",
        "M 300 200 L 300 420",
        "M 540 320 L 490 320 L 490 335 L 540 335 Z",
        "M 400 320 L 350 320 L 350 335 L 400 335 Z",
        "M 600 180 L 470 180 L 470 280",
        "M 470 180 L 300 180 L 300 280",
        "M 760 420 Q 760 360 710 360 Q 660 360 660 420",
        "M 280 420 Q 280 360 230 360 Q 180 360 180 420",
        "M 760 420 L 760 470 L 660 470 L 660 420",
        "M 280 420 L 280 470 L 180 470 L 180 420",
        "M 640 200 L 660 180 L 680 200",
        "M 900 420 L 80 420",
      ],
    },
  },
};

// --- Pickup (Silverado / F-Series silhouette) --------------------------
const PICKUP: VehicleTemplate = {
  slug: "pickup",
  label: "Pickup (Silverado / F-Series)",
  views: {
    top: {
      imageUrl: "/upfit-templates/pickup/top.png",
      fallbackPaths: [
        // Body outline
        "M 200 80 L 800 80 Q 860 80 880 140 L 880 460 Q 860 520 800 520 L 200 520 Q 140 520 120 460 L 120 140 Q 140 80 200 80 Z",
        // Hood
        "M 180 100 L 380 100 L 380 240 L 180 240 Z",
        // Cab
        "M 180 240 L 580 240 L 580 380 L 180 380 Z",
        // Cab roof
        "M 220 270 L 540 270 L 540 350 L 220 350 Z",
        // Bed
        "M 580 240 L 880 240 L 880 460 L 580 460 Z",
        // Tailgate
        "M 880 460 L 880 510",
        // Side mirrors L
        "M 180 280 L 150 270 L 150 320 L 180 310 Z",
        // Side mirrors R
        "M 180 280 L 215 270",
        // Wheel arches
        "M 150 130 L 200 130 L 200 175 L 150 175 Z",
        "M 150 425 L 200 425 L 200 470 L 150 470 Z",
        "M 800 130 L 850 130 L 850 175 L 800 175 Z",
        "M 800 425 L 850 425 L 850 470 L 800 470 Z",
      ],
    },
    front: {
      imageUrl: "/upfit-templates/pickup/front.png",
      fallbackPaths: [
        // Body
        "M 200 220 L 800 220 L 820 360 L 850 370 L 850 490 L 800 510 L 200 510 L 150 490 L 150 370 L 180 360 Z",
        // Hood
        "M 250 220 L 750 220 L 770 160 L 230 160 Z",
        // Cab roof
        "M 280 160 L 720 160 L 720 100 L 280 100 Z",
        // Grille (truck-style — large)
        "M 330 270 L 670 270 L 670 410 L 330 410 Z",
        "M 330 290 L 670 290",
        "M 330 320 L 670 320",
        "M 330 350 L 670 350",
        "M 330 380 L 670 380",
        // Headlights L
        "M 200 250 L 320 250 L 320 320 L 200 320 Z",
        // Headlights R
        "M 800 250 L 680 250 L 680 320 L 800 320 Z",
        // Bumper
        "M 150 470 L 850 470",
        "M 470 430 L 530 430 L 530 470 L 470 470 Z",
      ],
    },
    rear: {
      imageUrl: "/upfit-templates/pickup/rear.png",
      fallbackPaths: [
        // Body
        "M 200 200 L 800 200 L 820 360 L 850 370 L 850 490 L 800 510 L 200 510 L 150 490 L 150 370 L 180 360 Z",
        // Tailgate panel
        "M 200 220 L 800 220 L 800 410 L 200 410 Z",
        // Tailgate handle
        "M 460 290 L 540 290 L 540 320 L 460 320 Z",
        // Tail lights L
        "M 200 230 L 280 230 L 280 360 L 200 360 Z",
        // Tail lights R
        "M 800 230 L 720 230 L 720 360 L 800 360 Z",
        // CHMSL on cab
        "M 460 150 L 540 150 L 540 170 L 460 170 Z",
        // Roof line
        "M 250 200 L 750 200 L 770 100 L 230 100 Z",
        // Bumper
        "M 150 470 L 850 470",
        // Exhaust
        "M 720 480 L 760 480",
      ],
    },
    side_left: {
      imageUrl: "/upfit-templates/pickup/side_left.png",
      fallbackPaths: [
        // Body silhouette
        "M 80 280 Q 110 220 180 200 L 280 180 L 300 130 L 580 130 L 600 180 L 920 200 L 920 430 L 80 430 Z",
        // Cab back
        "M 600 180 L 600 430",
        // Door A
        "M 320 180 L 440 180 L 440 430",
        // Door B
        "M 530 180 L 530 430",
        // Bed
        "M 600 230 L 900 230 L 900 410 L 600 410 Z",
        // Bed top rail
        "M 600 230 L 600 200",
        "M 900 230 L 900 200",
        // Window seams
        "M 320 180 L 320 280 L 600 280",
        "M 440 180 L 440 280",
        "M 530 180 L 530 280",
        // Door handles
        "M 380 320 L 425 320 L 425 335 L 380 335 Z",
        "M 470 320 L 515 320 L 515 335 L 470 335 Z",
        // Wheel arches
        "M 200 430 Q 200 370 250 370 Q 300 370 300 430",
        "M 740 430 Q 740 370 790 370 Q 840 370 840 430",
        // Wheels
        "M 200 430 L 200 480 L 300 480 L 300 430",
        "M 740 430 L 740 480 L 840 480 L 840 430",
        // Side mirror
        "M 320 200 L 300 180 L 280 200",
      ],
    },
    side_right: {
      imageUrl: "/upfit-templates/pickup/side_right.png",
      fallbackPaths: [
        "M 920 280 Q 890 220 820 200 L 720 180 L 700 130 L 420 130 L 400 180 L 80 200 L 80 430 L 920 430 Z",
        "M 400 180 L 400 430",
        "M 680 180 L 560 180 L 560 430",
        "M 470 180 L 470 430",
        "M 400 230 L 100 230 L 100 410 L 400 410 Z",
        "M 400 230 L 400 200",
        "M 100 230 L 100 200",
        "M 680 180 L 680 280 L 400 280",
        "M 560 180 L 560 280",
        "M 470 180 L 470 280",
        "M 620 320 L 575 320 L 575 335 L 620 335 Z",
        "M 530 320 L 485 320 L 485 335 L 530 335 Z",
        "M 800 430 Q 800 370 750 370 Q 700 370 700 430",
        "M 260 430 Q 260 370 210 370 Q 160 370 160 430",
        "M 800 430 L 800 480 L 700 480 L 700 430",
        "M 260 430 L 260 480 L 160 480 L 160 430",
        "M 680 200 L 700 180 L 720 200",
      ],
    },
  },
};

// --- Sedan (Charger / Explorer-style cruiser) ---------------------------
const SEDAN: VehicleTemplate = {
  slug: "sedan",
  label: "Sedan (Charger / Patrol cruiser)",
  views: {
    top: {
      imageUrl: "/upfit-templates/sedan/top.png",
      fallbackPaths: [
        "M 180 100 L 820 100 Q 870 110 880 160 L 880 440 Q 870 490 820 500 L 180 500 Q 130 490 120 440 L 120 160 Q 130 110 180 100 Z",
        "M 220 170 L 780 170 L 760 270 L 240 270 Z",
        "M 240 270 L 760 270 L 760 360 L 240 360 Z",
        "M 240 360 L 760 360 L 780 440 L 220 440 Z",
        "M 500 100 L 500 170",
        "M 500 440 L 500 500",
        "M 240 260 L 220 255 L 220 285 L 240 280 Z",
        "M 760 260 L 780 255 L 780 285 L 760 280 Z",
        "M 200 150 L 230 150 L 230 185 L 200 185 Z",
        "M 770 150 L 800 150 L 800 185 L 770 185 Z",
        "M 200 415 L 230 415 L 230 450 L 200 450 Z",
        "M 770 415 L 800 415 L 800 450 L 770 450 Z",
      ],
    },
    front: {
      imageUrl: "/upfit-templates/sedan/front.png",
      fallbackPaths: [
        "M 180 280 L 820 280 L 850 410 L 870 420 L 870 490 L 820 510 L 180 510 L 130 490 L 130 420 L 150 410 Z",
        "M 230 280 L 770 280 L 790 220 L 210 220 Z",
        "M 270 220 L 730 220 L 730 160 L 270 160 Z",
        "M 340 350 L 660 350 L 660 410 L 340 410 Z",
        "M 340 370 L 660 370",
        "M 340 390 L 660 390",
        "M 180 310 L 320 310 L 320 360 L 180 360 Z",
        "M 820 310 L 680 310 L 680 360 L 820 360 Z",
        "M 130 470 L 870 470",
      ],
    },
    rear: {
      imageUrl: "/upfit-templates/sedan/rear.png",
      fallbackPaths: [
        "M 180 280 L 820 280 L 850 410 L 870 420 L 870 490 L 820 510 L 180 510 L 130 490 L 130 420 L 150 410 Z",
        "M 220 280 L 780 280 L 800 220 L 200 220 Z",
        "M 270 220 L 730 220 L 730 160 L 270 160 Z",
        "M 260 320 L 740 320 L 740 410 L 260 410 Z",
        "M 430 360 L 570 360 L 570 400 L 430 400 Z",
        "M 180 310 L 260 310 L 260 380 L 180 380 Z",
        "M 820 310 L 740 310 L 740 380 L 820 380 Z",
        "M 450 175 L 550 175 L 550 195 L 450 195 Z",
        "M 130 470 L 870 470",
      ],
    },
    side_left: {
      imageUrl: "/upfit-templates/sedan/side_left.png",
      fallbackPaths: [
        "M 80 350 Q 110 280 180 260 L 280 240 L 320 180 L 680 180 L 720 240 L 920 260 L 920 410 L 80 410 Z",
        "M 320 180 L 340 280 L 660 280 L 680 180",
        "M 340 280 L 360 240 L 360 410",
        "M 510 240 L 510 410",
        "M 660 240 L 660 410",
        "M 410 330 L 470 330 L 470 345 L 410 345 Z",
        "M 560 330 L 620 330 L 620 345 L 560 345 Z",
        "M 360 220 L 510 220 L 510 280",
        "M 510 220 L 660 220 L 660 280",
        "M 230 410 Q 230 350 280 350 Q 330 350 330 410",
        "M 700 410 Q 700 350 750 350 Q 800 350 800 410",
        "M 230 410 L 230 460 L 330 460 L 330 410",
        "M 700 410 L 700 460 L 800 460 L 800 410",
        "M 320 240 L 300 220 L 280 240",
      ],
    },
    side_right: {
      imageUrl: "/upfit-templates/sedan/side_right.png",
      fallbackPaths: [
        "M 920 350 Q 890 280 820 260 L 720 240 L 680 180 L 320 180 L 280 240 L 80 260 L 80 410 L 920 410 Z",
        "M 680 180 L 660 280 L 340 280 L 320 180",
        "M 660 280 L 640 240 L 640 410",
        "M 490 240 L 490 410",
        "M 340 240 L 340 410",
        "M 590 330 L 530 330 L 530 345 L 590 345 Z",
        "M 440 330 L 380 330 L 380 345 L 440 345 Z",
        "M 640 220 L 490 220 L 490 280",
        "M 490 220 L 340 220 L 340 280",
        "M 770 410 Q 770 350 720 350 Q 670 350 670 410",
        "M 300 410 Q 300 350 250 350 Q 200 350 200 410",
        "M 770 410 L 770 460 L 670 460 L 670 410",
        "M 300 410 L 300 460 L 200 460 L 200 410",
        "M 680 240 L 700 220 L 720 240",
      ],
    },
  },
};

export const VEHICLE_TEMPLATES: Record<string, VehicleTemplate> = {
  suv: SUV,
  pickup: PICKUP,
  sedan: SEDAN,
};

export const BODY_STYLES = Object.values(VEHICLE_TEMPLATES).map((t) => ({
  slug: t.slug,
  label: t.label,
}));

export function getTemplate(bodyStyle: string): VehicleTemplate {
  return VEHICLE_TEMPLATES[bodyStyle] ?? SUV;
}

// Translate a view's image URL into a server-side public/ filesystem
// path. Used by the PDF renderer which has to embed the image as bytes
// rather than fetch over HTTP. Returns null when the URL isn't one of
// our managed `/upfit-templates/...` paths.
export function localImagePath(imageUrl: string): string | null {
  if (!imageUrl.startsWith("/upfit-templates/")) return null;
  return `public${imageUrl}`;
}

// 12 high-contrast pin colors. The builder cycles through these so each
// pin is visually distinct without forcing the user to pick. User can
// still override per-pin.
export const PIN_PALETTE = [
  "#ef4444", // red
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#10b981", // green
  "#a855f7", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#14b8a6", // teal
  "#eab308", // yellow
  "#8b5cf6", // violet
];

export function nextPinColor(existing: number): string {
  return PIN_PALETTE[existing % PIN_PALETTE.length];
}
