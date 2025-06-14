export type KnockOutcome = 'not_home' | 'no_soliciting' | 'lead' | 'sale' | 'callback' | 'not_interested';

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