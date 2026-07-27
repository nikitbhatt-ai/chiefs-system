import {
  Wrench,
  PackagePlus,
  MapPin,
  Truck,
  Users as UsersIcon,
  Megaphone,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";
import type { CalendarEventType } from "@/lib/calendar";

export type CalEvent = {
  id: string;
  title: string;
  description: string | null;
  eventType: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  visibility: string;
  cancelledAt: string | null;
  createdBy: string;
  createdByName: string | null;
  customerId: string | null;
  customerName: string | null;
  dealId: string | null;
  dealLabel: string | null;
  workOrderId: string | null;
  woNumber: string | null;
  attendees: { userId: string; name: string | null; response: string }[];
  myResponse: string | null;
  canManage: boolean;
  createdAt: string;
};

export type UserOption = { id: string; name: string };
export type LinkOption = { id: string; label: string };

// Colour + icon per event type. We ALWAYS render the label/icon alongside the
// colour — the crew reads this on phones in direct sunlight, so colour alone
// can't be the only signal.
export type TypeStyle = {
  label: string;
  Icon: LucideIcon;
  chip: string; // event chip background/text/border
  dot: string; // legend + agenda dot
  badge: string; // detail-panel badge
};

export const TYPE_STYLES: Record<CalendarEventType, TypeStyle> = {
  service: {
    label: "Service",
    Icon: Wrench,
    chip: "bg-blue-500/15 text-blue-200 border-blue-500/40",
    dot: "bg-blue-400",
    badge: "bg-blue-500/15 text-blue-200 border-blue-500/40",
  },
  upfit: {
    label: "Upfit",
    Icon: PackagePlus,
    chip: "bg-amber-500/15 text-amber-200 border-amber-500/40",
    dot: "bg-amber-400",
    badge: "bg-amber-500/15 text-amber-200 border-amber-500/40",
  },
  offsite: {
    label: "Offsite install",
    Icon: MapPin,
    chip: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
    dot: "bg-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
  },
  delivery: {
    label: "Delivery",
    Icon: Truck,
    chip: "bg-purple-500/15 text-purple-200 border-purple-500/40",
    dot: "bg-purple-400",
    badge: "bg-purple-500/15 text-purple-200 border-purple-500/40",
  },
  customer_meeting: {
    label: "Customer meeting",
    Icon: UsersIcon,
    chip: "bg-pink-500/15 text-pink-200 border-pink-500/40",
    dot: "bg-pink-400",
    badge: "bg-pink-500/15 text-pink-200 border-pink-500/40",
  },
  announcement: {
    label: "Announcement",
    Icon: Megaphone,
    chip: "bg-red-500/15 text-red-200 border-red-500/40",
    dot: "bg-red-400",
    badge: "bg-red-500/15 text-red-200 border-red-500/40",
  },
  other: {
    label: "Other",
    Icon: CalendarDays,
    chip: "bg-zinc-500/15 text-zinc-300 border-zinc-500/40",
    dot: "bg-zinc-400",
    badge: "bg-zinc-500/15 text-zinc-300 border-zinc-500/40",
  },
};

export function styleFor(eventType: string): TypeStyle {
  return TYPE_STYLES[eventType as CalendarEventType] ?? TYPE_STYLES.other;
}
