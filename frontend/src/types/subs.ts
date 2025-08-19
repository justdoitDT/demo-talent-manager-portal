// frontend/src/types/subs.ts

// MINIMAL shape – extend as you flesh out tabs
export interface CreativeMini { id: string; name: string; }
export interface ManagerMini      { id: string; name: string; }
export interface ProjectMini   { id: string; title: string; media_type?: string|null; }
export interface RecipientMini {
  id: string;
  type: 'executive' | 'external_rep';
  name: string;
  company_id?: string|null;
  company_name?: string|null;
}
export interface SubFeedbackMini {
  id:            string;
  sentiment:     string;
  feedback_text: string | null;
  actionable_next: string | null;
  created_at:    string;                // ISO date string
  source_type:   'executive' | 'external_rep';
  source_id:     string;
}

export interface WritingSampleBase {
  id: string;
  filename: string;
  file_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface SubDetail {
  id: string;
  project: ProjectMini|null;
  intent_primary: string|null;
  project_need: string|null;
  result: string|null;
  created_at: string;
  updated_at: string;
  created_by: ManagerMini|null;

  clients:     CreativeMini[];
  originators: ManagerMini[];
  recipients:  RecipientMini[];
  writing_samples: WritingSampleBase[];
  feedback: SubFeedbackMini[];
}
