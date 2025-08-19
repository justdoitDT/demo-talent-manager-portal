# backend/app/models.py

from sqlalchemy import Column, String, Text, Boolean, Float, DateTime, Table, ForeignKey, Date, Integer, func, text
from sqlalchemy.orm import Session, relationship, joinedload
from datetime import datetime
from .database import Base

# Association tables
client_team_assignments = Table(
    'client_team_assignments',
    Base.metadata,
    Column('team_id', String, ForeignKey('team.id'), primary_key=True),
    Column('creative_id', String, ForeignKey('creatives.id'), primary_key=True),
)

creative_duo_members = Table(
    "creative_duo_members",
    Base.metadata,
    Column("duo_id",      String, ForeignKey("creative_duos.id"), primary_key=True),
    Column("creative_id", String, ForeignKey("creatives.id"),     primary_key=True),
)

creative_project_roles = Table(
    'creative_project_roles',
    Base.metadata,
    Column('creative_id', String, ForeignKey('creatives.id'),   primary_key=True),
    Column('project_id',  String, ForeignKey('projects.id'),    primary_key=True),
    Column('role',        String,                                primary_key=True),
)

project_genre_tags = Table(
    "project_genre_tags",
    Base.metadata,
    Column("project_id", String, ForeignKey("projects.id"), primary_key=True),
    Column("tag_id", String, ForeignKey("genre_tags.id"), primary_key=True),
)

writing_sample_to_creative = Table(
    "writing_sample_to_creative", Base.metadata,
    Column("writing_sample_id", String,
              ForeignKey("writing_samples.id"), primary_key=True),
    Column("creative_id",       String,
              ForeignKey("creatives.id"),        primary_key=True),
    Column("status",            String, nullable=False)         # active / archived
)

writing_sample_to_project = Table(
    "writing_sample_to_project", Base.metadata,
    Column("writing_sample_id", String,
              ForeignKey("writing_samples.id"), primary_key=True),
    Column("project_id",        String,
              ForeignKey("projects.id"),        primary_key=True),
    Column("status",            String, nullable=False)
)

sub_to_mandate = Table(
    "sub_to_mandate",
    Base.metadata,
    Column("sub_id",      String, ForeignKey("subs.id"),      primary_key=True),
    Column("mandate_id",  String, ForeignKey("mandates.id"), primary_key=True),
)

sub_to_team = Table(
    "sub_to_team",
    Base.metadata,
    Column("sub_id",  String, ForeignKey("subs.id"),  primary_key=True),
    Column("team_id", String, ForeignKey("team.id"), primary_key=True),
)

sub_to_client = Table(
    "sub_to_client",
    Base.metadata,
    Column("sub_id",      String, ForeignKey("subs.id"),       primary_key=True),
    Column("creative_id", String, ForeignKey("creatives.id"),  primary_key=True),
)

sub_to_writing_sample = Table(
    "sub_to_writing_sample",
    Base.metadata,
    Column("sub_id",            String, ForeignKey("subs.id"),            primary_key=True),
    Column("writing_sample_id", String, ForeignKey("writing_samples.id"), primary_key=True),
)

executives_to_tv_networks = Table(
    "executives_to_tv_networks", Base.metadata,
    Column("executive_id",    String, ForeignKey("executives.id"),    primary_key=True),
    Column("network_id",   String, ForeignKey("tv_networks.id"),   primary_key=True),
    Column("status",        String,  nullable=False, server_default="Active"),
    Column("title",         String,  nullable=True),
    Column("last_modified", DateTime(timezone=True), nullable=False, server_default=text("now()"), onupdate=text("now()")),
)
executives_to_studios = Table(
    "executives_to_studios", Base.metadata,
    Column("executive_id", String, ForeignKey("executives.id"), primary_key=True),
    Column("studio_id",    String, ForeignKey("studios.id"),    primary_key=True),
    Column("status",        String,  nullable=False, server_default="Active"),
    Column("title",         String,  nullable=True),
    Column("last_modified", DateTime(timezone=True), nullable=False, server_default=text("now()"), onupdate=text("now()")),
)
executives_to_production_companies = Table(
    "executives_to_production_companies", Base.metadata,
    Column("executive_id",        String, ForeignKey("executives.id"),           primary_key=True),
    Column("production_company_id", String, ForeignKey("production_companies.id"), primary_key=True),
    Column("status",        String,  nullable=False, server_default="Active"),
    Column("title",         String,  nullable=True),
    Column("last_modified", DateTime(timezone=True), nullable=False, server_default=text("now()"), onupdate=text("now()")),
)
project_to_executives = Table(
    "project_to_executives", Base.metadata,
    Column("project_id",   String, ForeignKey("projects.id"),   primary_key=True),
    Column("executive_id", String, ForeignKey("executives.id"), primary_key=True),
    Column("status",        String, nullable=False, server_default="Active"),
    Column("last_modified", DateTime(timezone=True), nullable=False, server_default=text("now()"), onupdate=text("now()")),
)
project_to_tv_networks = Table(
    "project_to_tv_networks", Base.metadata,
    Column("project_id", String, ForeignKey("projects.id"), primary_key=True),
    Column("network_id", String, ForeignKey("tv_networks.id"), primary_key=True),
    Column("status",        String, nullable=False, server_default="Active"),
    Column("last_modified", DateTime(timezone=True), nullable=False, server_default=text("now()"), onupdate=text("now()")),
)
project_to_studios = Table(
    "project_to_studios", Base.metadata,
    Column("project_id", String, ForeignKey("projects.id"), primary_key=True),
    Column("studio_id",  String, ForeignKey("studios.id"),  primary_key=True),
    Column("status",        String, nullable=False, server_default="Active"),
    Column("last_modified", DateTime(timezone=True), nullable=False, server_default=text("now()"), onupdate=text("now()")),
)
project_to_production_companies = Table(
    "project_to_production_companies", Base.metadata,
    Column("project_id",           String, ForeignKey("projects.id"),           primary_key=True),
    Column("production_company_id", String, ForeignKey("production_companies.id"), primary_key=True),
    Column("status",        String, nullable=False, server_default="Active"),
    Column("last_modified", DateTime(timezone=True), nullable=False, server_default=text("now()"), onupdate=text("now()")),
)
project_to_project_type = Table(
    "project_to_project_type",
    Base.metadata,
    Column("project_id", String, ForeignKey("projects.id"), primary_key=True),
    Column("type_id",    String, ForeignKey("project_types.id"), primary_key=True),
    Column("status",     String, nullable=False, server_default="Active"),
    Column(
        "last_modified",
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=text("now()"),
    ),
)




class Manager(Base):
    __tablename__ = 'team'
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_team_id()"))
    name         = Column(String, nullable=False)
    role         = Column(String)
    email        = Column(String, index=True)
    phone        = Column(String)
    created_at   = Column(DateTime)
    status       = Column(String, index=True)
    supabase_uid = Column(String)
    clients      = relationship(
        'Creative',
        secondary=client_team_assignments,
        back_populates='managers'
    )

class Creative(Base):
    __tablename__ = 'creatives'
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_creative_id()"))
    name             = Column(String, nullable=False)
    pronouns         = Column(String)
    imdb_id          = Column(String)          # just “nm123…” slug
    birthday         = Column(Date)            # full YYYY-MM-DD
    birth_year       = Column(Integer)
    phone            = Column(String)
    location         = Column(String)
    address          = Column(String)
    email            = Column(String, index=True)
    client_status    = Column(String, index=True)
    industry_notes   = Column(String)
    availability     = Column(String, index=True)
    unavailable_until= Column(DateTime)
    tv_acceptable    = Column(Boolean)
    is_director      = Column(Boolean)
    is_writer        = Column(Boolean)
    writer_level     = Column(Float)
    has_directed_feature = Column(Boolean, index=True, nullable=True)

    managers = relationship(
        'Manager',
        secondary=client_team_assignments,
        back_populates='clients'
    )

    projects = relationship(
    'Project',
    secondary=creative_project_roles,
    back_populates='creatives'
)

class CreativeDuo(Base):
    __tablename__ = "creative_duos"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_duo_id()"))
    name = Column(String, nullable=False)

class Survey(Base):
    __tablename__ = 'surveys'
    id          = Column(Integer, primary_key=True, autoincrement=True)  # ← int4
    creative_id = Column(String, ForeignKey('creatives.id'), index=True)
    created_at  = Column(DateTime)
    updated_at  = Column(DateTime)
    responses   = relationship('SurveyResponse', back_populates='survey')
    project_responses = relationship("ProjectSurveyResponse", back_populates="survey")

class SurveyResponse(Base):
    __tablename__ = 'survey_responses'
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_survey_response_id()"))
    survey_id     = Column(Integer, ForeignKey('surveys.id'), index=True)
    question_key  = Column(String, ForeignKey('survey_questions.key'))
    response      = Column('response', String)
    # …other columns…
    survey        = relationship('Survey', back_populates='responses')
    question      = relationship('SurveyQuestion')

class SurveyQuestion(Base):
    __tablename__ = 'survey_questions'
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_survey_question_id()"))
    key           = Column(String, unique=True, index=True)
    prompt        = Column(String, nullable=False)
    position      = Column(Integer)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        # keeps updated_at synced if you have a DB trigger; harmless otherwise
        {"comment": "Projects master table"},
    )

    id              = Column(String, primary_key=True,
                              server_default=text("gen_project_id()"))
    imdb_id         = Column(String)
    title           = Column(String, nullable=False)
    media_type      = Column(String)                 # varchar
    year            = Column(String)                 # varchar(4)
    description     = Column(String)
    status          = Column(String)                 # enum stored as varchar
    tracking_status = Column(String)                 # enum stored as varchar
    engagement      = Column(String)
    updates         = Column(String)
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(),
                              onupdate=func.now())

    # ——— relationships ———
    creatives = relationship(
        "Creative",
        secondary=creative_project_roles,
        back_populates="projects",
    )

    genres = relationship(
        "GenreTag",
        secondary=project_genre_tags,
        back_populates="projects",
    )

    survey_responses = relationship(
        "ProjectSurveyResponse",
        back_populates="project",
    )



class ProjectType(Base):
    __tablename__ = "project_types"
    id   = Column(String, primary_key=True,
                  server_default=text("gen_project_type_id()"))
    type = Column(String, nullable=False, unique=True)


class ProjectSurveyResponse(Base):
    __tablename__ = "project_survey_responses"

    survey_id          = Column(Integer, ForeignKey("surveys.id"), primary_key=True)
    project_id         = Column(String,  ForeignKey("projects.id"), primary_key=True)
    involvement_rating = Column(Integer, nullable=True)
    interest_rating    = Column(Integer, nullable=True)

    survey  = relationship("Survey", back_populates="project_responses")
    project = relationship("Project", back_populates="survey_responses")


class Note(Base):
    __tablename__ = "notes"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_note_id()"))
    note            = Column(Text, nullable=False)
    created_at      = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by_id   = Column(String, nullable=True)
    created_by_type = Column(String, nullable=True)
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    updated_by_id   = Column(String, nullable=True)
    updated_by_type = Column(String, nullable=True)
    status          = Column(String, nullable=True)
    visibility      = Column(String, nullable=True)

class NoteLink(Base):
    __tablename__ = "note_links"
    note_id       = Column(Integer, ForeignKey("notes.id"), primary_key=True)
    noteable_id   = Column(String,                       primary_key=True)
    noteable_type = Column(String,                       primary_key=True)

    note = relationship("Note", lazy="joined")


class GenreTag(Base):
    __tablename__ = "genre_tags"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_tag_id()"))
    name = Column(String, nullable=False, unique=True)

    # backref into projects
    projects = relationship(
        "Project",
        secondary=project_genre_tags,
        back_populates="genres",
    )



# ─── Writing samples ──────────────────────────────────────────────────────────
class WritingSample(Base):
    __tablename__ = "writing_samples"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_writing_sample_id()"))
    storage_bucket  = Column(String,  nullable=False)
    storage_path    = Column(String,  nullable=False)
    filename        = Column(String,  nullable=False)
    file_description= Column(String)
    synopsis        = Column(Text)
    file_type       = Column(String,  nullable=False)
    size_bytes      = Column(Integer, nullable=False)
    uploaded_by     = Column(String,  nullable=True)
    uploaded_at     = Column(DateTime, nullable=False,
                                server_default=func.now())

    projects  = relationship(
        "Project",
        secondary=writing_sample_to_project,
        lazy="joined",
    )
    creatives = relationship(
        "Creative",
        secondary=writing_sample_to_creative,
        lazy="joined",
    )



# ─── Mandates ──────────────────────────────────────────────────────────

class Mandate(Base):
    __tablename__ = "mandates"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_mandate_id()"))
    company_type= Column(String, nullable=False)             # e.g. "ST"
    company_id  = Column(String, nullable=False)             # e.g. "ST_00004"
    name        = Column(String, nullable=False)
    description = Column(String)
    status      = Column(String)
    created_at  = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)




# ─── Project Needs ──────────────────────────────────────────────────────────

class ProjectNeed(Base):
    __tablename__ = "project_needs"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_project_need_id()"))
    qualifications = Column(String)          # enum text
    description    = Column(Text)
    project_id     = Column(String, ForeignKey("projects.id"), nullable=False)
    status         = Column(
        String(16),
        nullable=False,
        default="Active",
        server_default="Active",
    )


# ─── Subs core table ─────────────────────────────────────────────
class Sub(Base):
    __tablename__ = "subs"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_sub_id()"))
    project_id        = Column(String, ForeignKey("projects.id"), nullable=False)
    intent_primary    = Column(String)
    project_need_id   = Column(String, ForeignKey("project_needs.id"), nullable=True)
    result            = Column(String)
    created_by        = Column(String, ForeignKey("team.id"), nullable=True)
    created_at        = Column(DateTime, server_default=func.now())
    updated_at        = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # relationships
    project           = relationship("Project", lazy="joined")
    project_need      = relationship("ProjectNeed", lazy="joined", foreign_keys=[project_need_id])
    originators       = relationship("Manager", secondary="sub_to_team", lazy="joined")
    clients           = relationship("Creative", secondary="sub_to_client", lazy="joined")
    recipients        = relationship("SubRecipient", cascade="all, delete-orphan", lazy="joined")
    writing_samples   = relationship("WritingSample", secondary="sub_to_writing_sample", lazy="joined")
    feedback          = relationship("SubFeedback", cascade="all, delete-orphan", order_by="SubFeedback.created_at.desc()")
    mandates          = relationship("Mandate", secondary="sub_to_mandate", lazy="joined")
    creator           = relationship("Manager", lazy="joined", foreign_keys=[created_by])



# ─── Recipients (execs / reps) ----------------------------------------------
class SubRecipient(Base):
    __tablename__ = "sub_recipients"
    sub_id         = Column(String, ForeignKey("subs.id"), primary_key=True)
    recipient_type = Column(String,     primary_key=True)   # 'executive' | 'external_rep'
    recipient_id   = Column(String,     primary_key=True)
    recipient_company = Column(String, nullable=True)       # NW_…, ST_…, PC_… or NULL


# ─── Feedback rows -----------------------------------------------------------
class SubFeedback(Base):
    __tablename__ = "sub_feedback"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_feedback_id()"))
    sub_id        = Column(String, ForeignKey("subs.id"), index=True)
    source_type   = Column(String)                       # 'executive' | 'external_rep'
    source_id     = Column(String)
    sentiment     = Column(String)                       # ENUM in DB
    feedback_text = Column(Text)
    actionable_next = Column(Text)
    created_by_team_id = Column(String, ForeignKey("team.id"))
    created_at    = Column(DateTime, server_default=func.now())


# ─── External entities -----------------------------------------------------------

class TVNetwork(Base):
    __tablename__ = "tv_networks"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_network_id()"))
    name = Column(String, nullable=False)

class Studio(Base):
    __tablename__ = "studios"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_studio_id()"))
    name = Column(String, nullable=False)

class ProductionCompany(Base):
    __tablename__ = "production_companies"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_production_company_id()"))
    name = Column(String, nullable=False)

class ExternalAgency(Base):
    __tablename__ = "external_agencies"

    id = Column(
        String,
        primary_key=True,
        server_default=text("gen_external_agency_id()"),
    )
    name = Column(String, nullable=False)



class Executive(Base):
    __tablename__ = "executives"
    id    = Column(
        String,
        primary_key=True,
        server_default=text("gen_executive_id()"))
    name = Column(String, nullable=False)
    email = Column(String)
    phone = Column(String)

    tv_networks          = relationship("TVNetwork",          secondary=executives_to_tv_networks)
    studios              = relationship("Studio",             secondary=executives_to_studios)
    production_companies = relationship("ProductionCompany",  secondary=executives_to_production_companies)



class ExternalTalentRep(Base):
    __tablename__ = "external_talent_reps"
    id         = Column(String, primary_key=True,
                        server_default=text("gen_external_rep_id()"))
    name       = Column(String, nullable=False)
    agency_id  = Column(String, ForeignKey("external_agencies.id"),
                        nullable=False)
    email      = Column(String)
    phone      = Column(String)

    created_at = Column(DateTime(timezone=True),
                        server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True),
                        server_default=text("now()"),
                        onupdate=text("now()"))

    # (optional) eager access
    agency = relationship("ExternalAgency", lazy="joined")




