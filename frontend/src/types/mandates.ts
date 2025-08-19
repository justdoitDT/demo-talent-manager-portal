// frontend/src/types/mandates.ts

// Minimal types used by MandatePane
export type CompanyType = 'tv_network' | 'studio' | 'production_company';

export interface MandateDetail {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  created_at?: string | null;   // ISO timestamp
  updated_at?: string | null;   // ISO timestamp
  company_id?: string | null;
  company_type?: 'tv_network' | 'studio' | 'production_company' | null;
}

export interface CompanyMini {
  id: string;
  name: string;
}

export type MandateUpdate = {
  name?:        string | null;
  description?: string | null;
  status?:      'active' | 'archived';
};