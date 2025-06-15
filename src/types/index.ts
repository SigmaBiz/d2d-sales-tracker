export type KnockOutcome = 
  // Primary outcomes
  | 'not_home'        // 👻 Nobody answered
  | 'convo'           // 💬 Had conversation
  | 'inspected'       // 🪜 Roof inspected
  | 'no_soliciting'   // 🚫 No soliciting sign
  | 'lead'            // ✅ Interested prospect
  | 'sale'            // 📝 Contract signed
  | 'callback'        // 🔄 Follow up needed
  // Property status
  | 'new_roof'        // 👼 Recently replaced roof
  | 'competitor'      // 🏗️ Another company working
  | 'renter'          // 🧟 Tenant, not owner
  | 'poor_condition'  // 🏚️ House in bad shape
  // Action taken
  | 'proposal_left'   // 📋 Left estimate/proposal
  | 'stay_away'       // 👹 Dangerous or problematic
  | 'revisit'         // 👀 Worth coming back
  // Legacy (for backward compatibility)
  | 'not_interested';

export interface Knock {
  id: string;
  latitude: number;
  longitude: number;
  address?: string;
  outcome: KnockOutcome;
  notes?: string;
  timestamp: Date;
  repId: string;
  syncStatus: 'pending' | 'synced';
  history?: Array<{
    outcome: KnockOutcome;
    timestamp: Date;
    notes?: string;
  }>;
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