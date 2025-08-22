# backend/app/schemas.py

from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List, Literal
from datetime import datetime
from uuid import UUID

# ─── Mini schemas for nested lists ───────────────────────────────────────

class CreativeMini(BaseModel):
    id: str
    name: str

    model_config = {"from_attributes": True}

class DuoMember(BaseModel):
    duo_id: str
    creative_id: str
    creative_name: str
    model_config = {"from_attributes": False}

class ManagerMini(BaseModel):
    id: str
    name: str

    model_config = {"from_attributes": True}

class CreativeProjectRole(BaseModel):
    creative_id: str
    creative_name: str
    project_id: str
    project_title: str
    role: str | None = None
    model_config = {"from_attributes": False}

class ProjectRoleRow(BaseModel):
    project_id: str
    project_title: str
    role: str | None = None
    year: int | None = None
    media_type: str | None = None
    status: str | None = None
    involvement_rating: int | None = None
    interest_rating:    int | None = None

class RecipientMini(BaseModel):
    id:            str
    type: Literal["executive", "external_rep", "creative"]
    name:          str
    company_id:    str | None = None
    company_name:  str | None = None

class SubFeedbackMini(BaseModel):
    id:             str
    sentiment:      str
    feedback_text:  str | None = None
    actionable_next: str | None = None
    created_at:     datetime
    source_type: Literal["executive", "external_rep", "creative"]
    source_id:      str

    model_config = {"from_attributes": True}

class SubFeedbackUpdate(BaseModel):
    """Full payload for create/upsert (all required except id/actionable)."""
    id: Optional[str] = None          # allow blank for new row
    sub_id: str
    source_type: str
    source_id: str
    sentiment: str
    feedback_text: str
    actionable_next: Optional[str] = None

class SubFeedbackPatch(BaseModel):
    """PATCH payload – only editable columns, all optional."""
    sentiment:       Optional[str] = None
    feedback_text:   Optional[str] = None
    actionable_next: Optional[str] = None

class ProjectNeedCreate(BaseModel):
    need:        str
    description: str | None = None




# ─── Full Read schemas ───────────────────────────────────────────────────

class CreativeCreate(BaseModel):
    name: str
    imdb_id: str | None = None
    client_status: str | None = None
    is_director: bool | None = None
    has_directed_feature: bool | None = None
    is_writer: bool | None = None
    writer_level: float | None = None
    tv_acceptable: bool | None = None
    pronouns: str | None = None
    birthday: str | None = None        # "MM/DD/9999"
    birth_year: int | None = None
    location: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    industry_notes: str | None = None
    availability: Optional[str]         = None
    unavailable_until: Optional[datetime] = None

class CreativeRead(BaseModel):
    id: str
    name: str
    pronouns: Optional[str] = None
    imdb_id: Optional[str]  = None
    birthday: Optional[datetime] = None           # full date
    birth_year: Optional[int] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    client_status: Optional[str] = None
    availability: Optional[str]         = None
    unavailable_until: Optional[datetime] = None
    tv_acceptable: Optional[bool]       = None
    is_writer: Optional[bool]           = None
    is_director: Optional[bool]         = None
    writer_level: Optional[float]       = None
    has_directed_feature: Optional[bool] = None
    industry_notes: Optional[str]       = None

    # use initials in the UI, but we fetch full names here
    managers: List[ManagerMini]         = []

    model_config = {"from_attributes": True}


class ManagerRead(BaseModel):
    id: str
    name: str
    role: Optional[str]                 = None
    email: Optional[str]                = None
    phone: Optional[str]                = None
    created_at: Optional[datetime]      = None
    supabase_uid: Optional[UUID]         = None

    # list of creatives the manager represents
    clients: List[CreativeMini]         = []

    model_config = {"from_attributes": True}


class ProjectRead(BaseModel):
    id:         str
    title:      str
    year:       Optional[int] = None
    media_type: Optional[str] = None
    status:     Optional[str] = None
    tracking_status: Optional[str] = None
    imdb_id:         Optional[str] = None
    updates:         Optional[str] = None
    description:     Optional[str] = None
    engagement:      Optional[str] = None
    project_types:   list[str] = []
    genres:          List["GenreTagMini"] = []
    network: Optional[str] = None
    studio:  Optional[str] = None

    model_config = {"from_attributes": True}


class ProjectCreate(BaseModel):
    # core fields
    title:            str
    imdb_id:          str | None = None
    media_type:       str
    year:             int | None = None
    description:      str | None = None
    status:           str
    tracking_status:  str

    # m‑n relations
    genre_tag_ids:   list[str] = []
    network_ids:     list[str] = []
    studio_ids:      list[str] = []
    prodco_ids:      list[str] = []
    executive_ids:   list[str] = []
    creative_ids:    list[str] = []      # clients when personal
    project_types:   list[str] = []
    needs:           list[ProjectNeedCreate] = []

    # not persisted in projects table but convenient for FE
    is_personal:     bool = False




# ─── Lean, flat Project list schema ───────────────────────────────────
class ProjectList(BaseModel):
    id:          str
    title:       str
    year:        Optional[int]    = None
    media_type:  Optional[str]    = None
    status:      Optional[str]    = None
    engagement:  Optional[str]    = None

    model_config = {"from_attributes": True}

class PagedProjects(BaseModel):
    total: int
    items: List[ProjectRead]


# ─── Update schemas for PATCH endpoints ─────────────────────────────────

class CreativeUpdate(BaseModel):
    name: Optional[str] = None
    pronouns: Optional[str] = None
    imdb_id: Optional[str]  = None
    birthday: Optional[datetime] = None
    birth_year: Optional[int] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    location: Optional[str] = None
    address: Optional[str] = None
    client_status:     Optional[str]   = None
    availability:      Optional[str]   = None
    unavailable_until: Optional[datetime] = None
    tv_acceptable:     Optional[bool]  = None
    is_writer:         Optional[bool]  = None
    is_director:       Optional[bool]  = None
    writer_level:      Optional[float] = None
    has_directed_feature: Optional[bool] = None
    industry_notes:    Optional[str]   = None

    model_config = {"from_attributes": True}


class SurveyRow(BaseModel):
    question: str
    answer: Optional[str] = None


class ProjectMini(BaseModel):
    id:         str
    title:      str
    year:       Optional[str] = None
    media_type: Optional[str] = None
    status:     Optional[str] = None
    tracking_status: Optional[str] = None

    model_config = {"from_attributes": True}


class ProjectWithRole(BaseModel):
    id: str
    title: str
    year: Optional[int]
    media_type: Optional[str]
    status: Optional[str]
    role: str

    # new ratings
    involvement_rating: Optional[int] = None
    interest_rating:    Optional[int] = None

    class Config:
        orm_mode = True
        

class ProjectWithRole(ProjectMini):
    role: str                  # “Creator”, “Writer”, “Director”, etc.


class ProjectUpdate(BaseModel):
    title:         Optional[str] = None
    year:          Optional[int] = None
    media_type:    Optional[str] = None
    status:        Optional[str] = None
    tracking_status: Optional[str] = None
    imdb_id:       Optional[str] = None
    updates:       Optional[str] = None
    description:   Optional[str] = None
    engagement:      Optional[str] = None
    genre_ids:        Optional[List[str]] = None



class ProjectNeed(BaseModel):
    id: str
    project_id: str
    qualifications: str | None
    description: str | None
    status: Literal["Active", "Archived"]

    class Config:
        from_attributes = True

class ProjectNeedCreate(BaseModel):
    project_id:     str
    qualifications: str                  # enum text
    description:    str | None = None
    project_types:  list[str] = []       # leave empty for the modal

class ProjectNeedCreateNested(BaseModel):
    qualifications: str
    description:    str | None = None
    project_types:  list[str] = []

class ProjectNeedUpdate(BaseModel):
    status: Literal["Active", "Archived"]



class NoteRead(BaseModel):
    id: int
    note: str
    created_at: datetime
    created_by_id: Optional[str]
    created_by_type: Optional[str]
    updated_at: datetime
    updated_by_id: Optional[str]
    updated_by_type: Optional[str]
    status: Optional[str]
    visibility: Optional[str]

    class Config:
        orm_mode = True

class NoteCreate(BaseModel):
    note: str


class GenreTagMini(BaseModel):
    id:   str
    name: str

    model_config = {"from_attributes": True}



# Writing Samples

class WritingSampleBase(BaseModel):
    id:              str
    filename:        str
    file_type:       str
    size_bytes:      int
    uploaded_at:     datetime
    file_description: str | None = None

    class Config:
        from_attributes = True


class WritingSampleDetail(WritingSampleBase):
    synopsis: str | None = None
    uploaded_by: str | None = None
    uploaded_by_name: str | None = None
    # .uploaded_at and the other base‑class fields already come through
    projects:  list[ProjectMini]  = []
    creatives: list[CreativeMini] = []


class WritingSampleListRow(WritingSampleBase):
    project_title:   Optional[str] = None
    sub_count:       int


class WritingSampleCreate(BaseModel):
    storage_bucket:  str
    storage_path:    str
    filename:        str
    file_description:str | None = None
    synopsis:        str | None = None
    file_type:       str
    size_bytes:      int


class WritingSampleUpdate(BaseModel):
    file_description: Optional[str] = None
    synopsis: Optional[str] = None

    class Config:
        from_attributes = True


  



class ProjectNeedMini(BaseModel):
    id:             str
    qualifications: str
    description:    str | None = None
    model_config = {"from_attributes": True}




class MandateMini(BaseModel):
    id:          str
    name:        str
    description: str | None = None
    status:      str
    model_config = {"from_attributes": True}

class MandateListItem(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    status: Optional[str] = None
    updated_at: Optional[datetime] = None
    company_id: Optional[str] = None
    company_type: Optional[Literal["tv_network", "studio", "production_company", "creative"]] = None
    model_config = {"from_attributes": True}

# Detail view schema for the Mandate pane
class MandateDetail(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    company_id: Optional[str] = None
    company_type: Optional[Literal["tv_network", "studio", "production_company", "creative"]] = None
    # add richer fields/relations here
    model_config = {"from_attributes": True}

class PagedMandates(BaseModel):
    total: int
    items: list[MandateListItem]

class MandateUpdate(BaseModel):
    name:        Optional[str] = None
    description: Optional[str] = None
    status:      Optional[Literal["active", "archived"]] = None
    company_id:   Optional[str] = None
    company_type: Optional[Literal["tv_network", "studio", "production_company", "creative"]] = None

    model_config = {"from_attributes": True}


class MandateCreate(BaseModel):
    name: str
    description: str | None = None
    company_id: str
    company_type: Literal["tv_network", "studio", "production_company", "creative"]
    # FE always sets active, but backend will also enforce it


# ─── Subs attached to a Mandate (list row) ───────────────────────────────
class SubForMandate(BaseModel):
    id: str
    project_id: str | None = None
    project_title: str | None = None
    clients: list[CreativeMini]        # from sub_to_client
    recipients: list[RecipientMini]    # from sub_recipients (executive | external_rep | creative)
    feedback: Literal["positive", "not_positive", "none"]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RecipientRow(BaseModel):
    """
    One row in the Recipients section of the ‘create / update Sub’ forms.
    """
    recipient_type: str                 # 'executive' | 'external_rep'
    recipient_id:   str
    recipient_company: Optional[str] = None   # e.g. ST_00003

    model_config = {"from_attributes": True}


class SubCreate(BaseModel):
    """
    Payload for POST /subs   (everything required for a brand‑new Sub)
    Supabase will autogenerate the “SB_…” primary‑key once the row is inserted.
    """
    project_id:        str                           # required FK
    intent_primary:    Optional[str] = None          # ENUM text
    project_need_id:   Optional[str] = None          # FK → project_needs.id
    result:            Optional[str] = None          # ENUM text
    # created_by:        str                           # TM_… id of creator
    client_ids:         List[str]                    # one or more CR_… ids
    originator_ids:     List[str]                    # one or more TM_… ids
    recipient_rows:     List[RecipientRow]           # at least one
    mandate_ids:        List[str] = []               # 0‑n MD_… ids
    writing_sample_ids: List[str] = []               # 0‑n WS_… ids

    model_config = {"from_attributes": True}


class SubUpdate(BaseModel):
    """
    Payload for PUT /subs/{id}.
    *All* fields are optional — supply only what you want to replace.
    For list fields, pass the *full replacement list* (or omit to leave unchanged).
    """
    project_id:        Optional[str] = None
    intent_primary:    Optional[str] = None
    project_need_id:   Optional[str] = None
    result:            Optional[str] = None

    client_ids:         Optional[List[str]] = None
    originator_ids:     Optional[List[str]] = None
    recipient_rows:     Optional[List[RecipientRow]] = None
    mandate_ids:        Optional[List[str]] = None
    writing_sample_ids: Optional[List[str]] = None

    model_config = {"from_attributes": True}



class SubListRow(BaseModel):
    sub_id:            str
    created_at:        datetime
    updated_at:        datetime
    clients:           str          | None   # "Trey Parker, Matt Stone"
    project_id:        str | None
    project_title:     str | None
    media_type:        str
    intent_primary:    str | None
    executives:        str | None   # "Kathleen Kennedy, Kevin Feige"
    recipient_company: str | None
    result:            str | None
    feedback_count:    int
    has_positive:      bool
    recipients:        list[RecipientMini] = []   # ← add structured recipients
    clients_list:      list[CreativeMini]  = []
    # (optional, for the modal label + bubble)
    feedback_id:         str | None = None
    feedback_sentiment:  str | None = None        # 'positive' | 'not positive'
    feedback_text:       str | None = None
    feedback_created_at: datetime | None = None

    model_config = {"from_attributes": True}


class SubDetail(BaseModel):
    id: str
    project:        ProjectMini | None
    intent_primary: str | None
    project_need:   ProjectNeedMini | None
    result:         str | None
    created_at:     datetime
    updated_at:     datetime
    created_by:     ManagerMini | None

    clients:        list[CreativeMini] = []
    originators:    list[ManagerMini]  = []
    recipients:     list[RecipientMini] = []
    writing_samples: list[WritingSampleBase] = []
    feedback:        list[SubFeedbackMini]  = []
    mandates:        list[MandateMini]      = []


class PagedSubs(BaseModel):
    total: int
    items: List[SubListRow]

    model_config = {"from_attributes": True}





# ─── Companies (read) ──────────────────────────────────────────
class CompanyMini(BaseModel):
    id:   str
    name: str
    class Config: orm_mode = True

class TVNetwork(BaseModel):
    id: str
    name: str
    class Config: orm_mode = True

class Studio(BaseModel):
    id: str
    name: str
    class Config: orm_mode = True

class ProductionCompany(BaseModel):
    id: str
    name: str
    class Config: orm_mode = True

class ExternalAgency(BaseModel):
    id: str
    name: str
    model_config = {"from_attributes": True}


# ─── Companies (create) ────────────────────────────────────────
class TVNetworkCreate(BaseModel):
    name: str

class StudioCreate(BaseModel):
    name: str

class ProductionCompanyCreate(BaseModel):
    name: str

class ExternalAgencyCreate(BaseModel):
    name: str




# ─── Executives ───────────────────────────────────────────────────────────────
class ExecutiveBase(BaseModel):
    name:  str
    email: str | None = None
    phone: str | None = None
    
    tv_networks: list[TVNetwork] = []
    studios: list[Studio] = []
    production_companies: list[ProductionCompany] = []

class ExecutiveCreate(ExecutiveBase):      # POST payload
    company_type : Literal['network', 'studio', 'prodco']
    company_id   : str

class ExecutivePatch(BaseModel):
    name:  str | None = None
    email: str | None = None
    phone: str | None = None

class Executive(ExecutiveBase):            # response
    id: str
    class Config: orm_mode = True

# ─── Executives list (flattened rows) ────────────────────────────────────────
class ExecutiveListRow(BaseModel):
    executive_id:   str
    executive_name: str
    company_id:     Optional[str] = None
    company_name:   Optional[str] = None
    company_type:   Optional[Literal["tv_network", "studio", "production_company"]] = None

    model_config = {"from_attributes": True}

class PagedExecutives(BaseModel):
    total: int
    items: List[ExecutiveListRow]

# ─── Executives – Companies (flat rows) ─────────────────────────────────────

class ExecCompanyLink(BaseModel):
    company_id: str
    company_name: str
    company_type: Literal["tv_network", "studio", "production_company"]
    status: Literal["Active", "Archived"]
    last_modified: datetime
    title: Optional[str] = None

    model_config = {"from_attributes": False}

class ExecCompaniesResponse(BaseModel):
    current: list[ExecCompanyLink]
    past: list[ExecCompanyLink]


# pulls in both "Active" and "Archived"
class ExecutiveAtCompanyRow(BaseModel):
    executive_id:   str
    executive_name: str
    email:          Optional[str] = None
    phone:          Optional[str] = None
    status:         Literal["Active", "Archived"]
    title:          Optional[str] = None
    last_modified:  Optional[datetime] = None

    model_config = {"from_attributes": False}


# ─── Executives list (AGGREGATED: 1 row per exec) ────────────────────────────
CompanyType = Literal["tv_network", "studio", "production_company"]

class ExecutiveAggListRow(BaseModel):
    executive_id:   str
    executive_name: str
    company_ids:    list[str] = []
    company_names:  list[str] = []              # FE can join(', ')
    company_types:  list[CompanyType] = []

    model_config = {"from_attributes": True}

class PagedExecutivesAgg(BaseModel):
    total: int
    items: list[ExecutiveAggListRow]

class CompanyProjectRow(BaseModel):
    id: str
    title: str
    year: int | str | None = None
    tracking_status: str | None = None
    engagement: str | None = None
    project_types: list[str] = []
    sub_count: int

    model_config = {"from_attributes": True}


# ─── Executives – Subs & Feedback rows ──────────────────────────────────────

class ExecSubFeedbackRow(BaseModel):
    sub_id: str
    sub_created_at: datetime
    intent_primary: Optional[str] = None
    result: Optional[str] = None
    project_id: Optional[str] = None
    project_title: Optional[str] = None
    media_type: Optional[str] = None

    # feedback fields (nullable when no feedback)
    feedback_id: Optional[str] = None
    feedback_sentiment: Optional[str] = None
    feedback_text: Optional[str] = None
    feedback_created_at: Optional[datetime] = None

    # clients (for clickable names)
    clients: list[CreativeMini] = []

class PagedExecSubFeedback(BaseModel):
    total: int
    items: list[ExecSubFeedbackRow]



# ─── External Talent Reps ─────────────────────────────────────────────────────
class RepBase(BaseModel):
    id: str
    name: str
    agency: ExternalAgency          # ← joined read
    email: str | None = None
    phone: str | None = None
    model_config = {"from_attributes": True}

class ExternalRepCreate(RepBase):
    name: str
    agency_id: str                 # 🔸 FK, not the name
    email: str | None = None
    phone: str | None = None

class ExternalRep(RepBase):
    id: str
    created_at: datetime
    updated_at: datetime
    class Config: orm_mode = True