export type KnockOutcome = 
  // Primary outcomes
  | 'not_home'        // 👻 Nobody answered
  | 'revisit'         // 👀 Worth coming back
  | 'no_soliciting'   // 🚫 No soliciting sign
  | 'lead'            // ✅ Interested prospect
  | 'sale'            // 📝 Contract signed
  | 'callback'        // 🔄 Follow up needed
  // Property status
  | 'new_roof'        // 🏠 Recently replaced roof
  | 'competitor'      // 🚧 Another company working
  | 'renter'          // 🔑 Tenant, not owner
  | 'poor_condition'  // 🏚️ House in bad shape
  // Action taken
  | 'proposal_left'   // 📋 Left estimate/proposal
  | 'stay_away'       // ⚠️ Dangerous or problematic
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