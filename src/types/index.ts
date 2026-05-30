export type KnockOutcome =
  | 'no_home'          // 👻 Nobody answered
  | 'not_interested'   // 🙅 Clear rejection
  | 'no_soliciting'    // 🚫 Sign on door
  | 'renter'           // 🧟 Tenant, not owner
  | 'conversation'     // 💬 Engaged, some interest
  | 'inspected'        // 🪜 Roof assessed
  | 'signed'           // 🔏 Contract signed
  | 'follow_up'        // 🔄 Warm, needs another touch
  | 'lead'             // ✅ Hot, qualified prospect
  | 'scout'            // 📍 Address noted for future canvassing
  | 'flaked'           // 🥀 Homeowner backed out / never genuinely interested
  | 'retarget';        // 🎯 Inspection ran but couldn't close — worth another pass

export const KNOCK_OUTCOME_EMOJI: Record<KnockOutcome, string> = {
  no_home:        '👻',
  not_interested: '🙅',
  no_soliciting:  '🚫',
  renter:         '🧟',
  conversation:   '💬',
  inspected:      '🪜',
  signed:         '🔏',
  follow_up:      '🔄',
  lead:           '✅',
  scout:          '📍',
  flaked:         '🥀',
  retarget:       '🎯',
};

export const KNOCK_OUTCOME_LABEL: Record<KnockOutcome, string> = {
  no_home:        'No Home',
  not_interested: 'Not Interested',
  no_soliciting:  'No Soliciting',
  renter:         'Renter',
  conversation:   'Conversation',
  inspected:      'Inspected',
  signed:         'Signed',
  follow_up:      'Follow Up',
  lead:           'Lead',
  scout:          'Scout',
  flaked:         'Flaked',
  retarget:       'Retarget',
};

// ── Lead lifecycle (F2a foundations) ──────────────────────────────────────────
// Two-axis model: a door keeps a stable `label` (the pin you see on the map),
// while `status` tracks the live/scheduled inspection lifecycle. When a lifecycle
// terminates, the terminal status is mirrored back onto the door's `label`.

export type ServiceType = 'live' | 'scheduled' | 'repair'; // repair deferred

export type LeadStatus =
  | 'scheduled'   // setter booked a future inspection (awaiting runner acknowledge)
  | 'pinged'      // setter alerted runner of a live lead
  | 'confirmed'   // runner acknowledged a scheduled lead
  | 'completed'   // inspection was run
  | 'processing'  // run, runner working the close (not yet closed)
  | 'signed'      // closed — pay trigger (== "contracted" for now)
  | 'arch_soft'   // not run as planned; recoverable (one recovery)
  | 'arch_hard'   // cannot be run; locked for the cycle (override only)
  | 'retarget';   // ran but couldn't close
// Future split (design only, do not build): 'contracted' | 'production'
//   signed = homeowner signs · contracted = insurance approved + finalized · production = built.

// Role-scoped lab sets. Setters (members) cannot apply salesman/runner outcomes;
// the server re-validates every write — this is a UX convenience, not the gate.
export const SETTER_LABS: KnockOutcome[] = [
  'no_home', 'not_interested', 'no_soliciting', 'renter',
  'conversation', 'follow_up', 'lead', 'scout',
];
export const RUNNER_LABS: KnockOutcome[] = [
  ...SETTER_LABS, 'inspected', 'signed', 'flaked', 'retarget',
];

export function labsForRole(role: 'owner' | 'member' | null | undefined): KnockOutcome[] {
  return role === 'owner' ? RUNNER_LABS : SETTER_LABS;
}

export interface Knock {
  id: string;
  user_id?: string;
  latitude: number;
  longitude: number;
  address?: string;
  label: KnockOutcome;
  notes?: string;
  photo_url?: string;
  storm_date?: string; // YYYY-MM-DD of storm that prompted this canvass
  knocked_at: Date;
  syncStatus: 'pending' | 'synced';
  // Lead lifecycle (F2a). Null/undefined until a door enters an inspection flow.
  service_type?: ServiceType;
  status?: LeadStatus;
  cycle_number?: number;     // which cycle this door is on (default 1)
  date_of_loss?: string;     // YYYY-MM-DD storm/campaign date governing the cycle
  appointment_at?: string;   // ISO — current scheduled inspection time (scheduled flow)
  year_built?: number; // property year built (from Redfin/manual entry)
  sqft?: number;       // property square footage (from Redfin/manual entry)
  history?: Array<{
    previous_label: KnockOutcome;
    new_label: KnockOutcome;
    changed_at: Date;
    notes?: string;
  }>;
}

export interface KnockContact {
  id: string;
  knock_id: string;
  name?: string;
  phone?: string;
  email?: string;
  insurance_carrier?: string;
  is_owner: boolean;
}

export interface Appointment {
  id: string;
  knock_id: string;
  scheduled_at: Date;
  notes?: string;
  status: 'pending' | 'completed' | 'cancelled';
}

export interface Territory {
  id: string;
  name: string;
  bounds: {
    northeast: { lat: number; lng: number };
    southwest: { lat: number; lng: number };
  };
  avgIncome?: number;
  performance?: {
    contactRate: number;
    conversionRate: number;
    totalKnocks: number;
  };
}

export interface DailyStats {
  date: Date;
  knocks: number;
  contacts: number;
  leads: number;
  sales: number;
  revenue: number;
}

export interface Rep {
  id: string;
  name: string;
  email: string;
  teamId?: string;
}

export interface HailEvent {
  id: string;
  date: Date;
  location: {
    lat: number;
    lng: number;
  };
  severity: 'light' | 'moderate' | 'severe';
  affectedRadius: number; // in miles
}

export interface ContactFormData {
  fullName?: string;
  goByName?: string;
  phone: string;
  email?: string;
  appointmentTime: Date | string;
  insuranceCarrier?: string;
  outcome: 'lead' | 'callback' | 'sale';
  address: string;
}

export interface ContactForm {
  id: string;
  knockId: string;
  formData: ContactFormData;
  createdAt: Date;
}

export interface NotificationLogEntry {
  id: string;
  timestamp: Date;
  type: 'initial' | 'escalation' | 'expansion';
  message: string;
  location: {
    latitude: number;
    longitude: number;
    city?: string;
  };
  hailSize: number; // in inches
  confidence: number; // percentage
  stormId?: string;
  actioned: boolean;
  createdAt: Date;
}