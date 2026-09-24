--
-- PostgreSQL database dump
--

\restrict 4zsdjEpKYCBU1XVwSPiwmGIQ5XeKluDZxXldbz39SdneFCTKEFtH4rPovRw2wL5

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    singleton boolean DEFAULT true NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_settings_singleton_check CHECK (singleton)
);


--
-- Name: article_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_briefs (
    id bigint NOT NULL,
    opportunity_id text,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending_review'::text NOT NULL,
    article_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT article_briefs_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text, 'generated'::text])))
);


--
-- Name: article_briefs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.article_briefs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: article_briefs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.article_briefs_id_seq OWNED BY public.article_briefs.id;


--
-- Name: articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.articles (
    id bigint NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    handle text DEFAULT ''::text NOT NULL,
    excerpt text DEFAULT ''::text NOT NULL,
    meta_title text DEFAULT ''::text NOT NULL,
    meta_description text DEFAULT ''::text NOT NULL,
    body_html text DEFAULT ''::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    author text DEFAULT ''::text NOT NULL,
    featured_image_url text,
    featured_image_alt text,
    primary_keyword text DEFAULT ''::text NOT NULL,
    secondary_keywords text[] DEFAULT '{}'::text[] NOT NULL,
    topic_fingerprint text DEFAULT ''::text NOT NULL,
    rationale text DEFAULT ''::text NOT NULL,
    scheduled_for timestamp with time zone,
    published_at timestamp with time zone,
    shopify_blog_id text,
    shopify_article_id text,
    shopify_handle text,
    shopify_url text,
    shopify_response_status text,
    generation_error text,
    last_error text,
    idempotency_key text,
    source text DEFAULT 'manual'::text NOT NULL,
    merchant_edited boolean DEFAULT false NOT NULL,
    merchant_edited_fields text[] DEFAULT '{}'::text[] NOT NULL,
    generation_settings jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT articles_status_check CHECK ((status = ANY (ARRAY['idea'::text, 'generating'::text, 'draft'::text, 'ready'::text, 'scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text, 'archived'::text])))
);


--
-- Name: articles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.articles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: articles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.articles_id_seq OWNED BY public.articles.id;


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id bigint NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    article_id bigint,
    job_id bigint,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_events_id_seq OWNED BY public.audit_events.id;


--
-- Name: cluster_claim_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cluster_claim_requirements (
    id text NOT NULL,
    cluster_id text NOT NULL,
    claim_class text NOT NULL,
    normalized_claim text NOT NULL,
    support_status text NOT NULL,
    payload jsonb NOT NULL,
    material_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cluster_evidence_budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cluster_evidence_budgets (
    cluster_id text NOT NULL,
    canonical_reader_task_id text NOT NULL,
    evaluation_version text NOT NULL,
    payload jsonb NOT NULL,
    material_hash text NOT NULL,
    readiness_status text NOT NULL,
    schema_version text NOT NULL,
    pipeline_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clustering_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clustering_runs (
    id bigint NOT NULL,
    clustering_version text NOT NULL,
    inserted_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    unchanged_count integer DEFAULT 0 NOT NULL,
    superseded_count integer DEFAULT 0 NOT NULL,
    active_cluster_count integer DEFAULT 0 NOT NULL,
    review_candidate_count integer DEFAULT 0 NOT NULL,
    conflict_pair_count integer DEFAULT 0 NOT NULL,
    unassigned_task_count integer DEFAULT 0 NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clustering_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clustering_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clustering_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clustering_runs_id_seq OWNED BY public.clustering_runs.id;


--
-- Name: evidence_approval_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_approval_audits (
    id bigint NOT NULL,
    source_evidence_id text NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    approval_method text,
    content_hash text,
    usage_scope text,
    public_usage_allowed boolean,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evidence_approval_audits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.evidence_approval_audits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: evidence_approval_audits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.evidence_approval_audits_id_seq OWNED BY public.evidence_approval_audits.id;


--
-- Name: evidence_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_reports (
    id bigint NOT NULL,
    article_id bigint NOT NULL,
    brief_id bigint,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evidence_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.evidence_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: evidence_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.evidence_reports_id_seq OWNED BY public.evidence_reports.id;


--
-- Name: knowledge_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_approvals (
    id bigint NOT NULL,
    entry_id text NOT NULL,
    revision_id text NOT NULL,
    content_hash text NOT NULL,
    approval_state text NOT NULL,
    approved_by text NOT NULL,
    approved_at timestamp with time zone NOT NULL,
    approval_method text NOT NULL,
    public_usage_allowed boolean DEFAULT false NOT NULL,
    usage_scope text DEFAULT ''::text NOT NULL,
    invalidated_at timestamp with time zone,
    invalidation_reason text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_approvals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_approvals_id_seq OWNED BY public.knowledge_approvals.id;


--
-- Name: knowledge_audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_audit_events (
    id bigint NOT NULL,
    entry_id text,
    action text NOT NULL,
    actor text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_audit_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_audit_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_audit_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_audit_events_id_seq OWNED BY public.knowledge_audit_events.id;


--
-- Name: knowledge_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_claims (
    id text NOT NULL,
    cluster_id text NOT NULL,
    claim_class text NOT NULL,
    normalized_claim text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_entries (
    id text NOT NULL,
    knowledge_class text NOT NULL,
    normalized_claim text NOT NULL,
    exact_approved_fact text NOT NULL,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_type text NOT NULL,
    source_reference text NOT NULL,
    provenance text DEFAULT ''::text NOT NULL,
    approval_state text NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    approval_method text,
    content_hash text NOT NULL,
    revision_id text NOT NULL,
    public_usage_allowed boolean DEFAULT false NOT NULL,
    usage_scope text DEFAULT ''::text NOT NULL,
    firsthand boolean DEFAULT false NOT NULL,
    confidence text DEFAULT 'unknown'::text NOT NULL,
    effective_from timestamp with time zone,
    effective_to timestamp with time zone,
    freshness_policy_days integer,
    contradictions jsonb DEFAULT '[]'::jsonb NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by text,
    revoke_reason text,
    schema_version text NOT NULL,
    pipeline_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
    material_hash text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_entries_approval_state_check CHECK ((approval_state = ANY (ARRAY['PENDING_APPROVAL'::text, 'APPROVED'::text, 'REJECTED'::text, 'REVOKED'::text, 'INVALIDATED'::text, 'STALE'::text])))
);


--
-- Name: knowledge_entry_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_entry_revisions (
    revision_id text NOT NULL,
    entry_id text NOT NULL,
    content_hash text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_evaluation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_evaluation_runs (
    id bigint NOT NULL,
    evaluation_version text NOT NULL,
    inserted_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    unchanged_count integer DEFAULT 0 NOT NULL,
    cluster_count integer DEFAULT 0 NOT NULL,
    material_hash text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_evaluation_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_evaluation_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_evaluation_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_evaluation_runs_id_seq OWNED BY public.knowledge_evaluation_runs.id;


--
-- Name: knowledge_source_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_source_links (
    entry_id text NOT NULL,
    source_evidence_id text NOT NULL,
    link_role text DEFAULT 'supports'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_interview_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_interview_answers (
    packet_id text NOT NULL,
    question_id text NOT NULL,
    entry_id text,
    revision_id text,
    answer_text text NOT NULL,
    approval_state text DEFAULT 'PENDING_APPROVAL'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_interview_packets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_interview_packets (
    id text NOT NULL,
    knowledge_class text NOT NULL,
    payload jsonb NOT NULL,
    material_hash text NOT NULL,
    completion_status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merchant_interview_packets_completion_status_check CHECK ((completion_status = ANY (ARRAY['open'::text, 'answered_pending_approval'::text, 'approved'::text, 'closed'::text])))
);


--
-- Name: merchant_interview_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_interview_questions (
    id text NOT NULL,
    packet_id text NOT NULL,
    prompt text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_interviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_interviews (
    id bigint NOT NULL,
    brief_id bigint NOT NULL,
    payload jsonb NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_interviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merchant_interviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merchant_interviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.merchant_interviews_id_seq OWNED BY public.merchant_interviews.id;


--
-- Name: merchant_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_knowledge (
    id bigint NOT NULL,
    topic_class text NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    source_brief_id bigint,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_by text DEFAULT 'merchant'::text NOT NULL,
    reusable boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: merchant_knowledge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merchant_knowledge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merchant_knowledge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.merchant_knowledge_id_seq OWNED BY public.merchant_knowledge.id;


--
-- Name: opportunity_cluster_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_cluster_audits (
    id bigint NOT NULL,
    cluster_id text NOT NULL,
    action text NOT NULL,
    actor text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: opportunity_cluster_audits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opportunity_cluster_audits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opportunity_cluster_audits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opportunity_cluster_audits_id_seq OWNED BY public.opportunity_cluster_audits.id;


--
-- Name: opportunity_cluster_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_cluster_evidence (
    cluster_id text NOT NULL,
    source_evidence_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: opportunity_cluster_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_cluster_members (
    cluster_id text NOT NULL,
    reader_task_id text NOT NULL,
    semantic_fingerprint text DEFAULT ''::text NOT NULL,
    join_reason text DEFAULT ''::text NOT NULL,
    is_canonical boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    clustering_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone
);


--
-- Name: opportunity_cluster_review_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_cluster_review_candidates (
    id bigint NOT NULL,
    left_reader_task_id text NOT NULL,
    right_reader_task_id text NOT NULL,
    similarity_score double precision NOT NULL,
    explanation text NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    clustering_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: opportunity_cluster_review_candidates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opportunity_cluster_review_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opportunity_cluster_review_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opportunity_cluster_review_candidates_id_seq OWNED BY public.opportunity_cluster_review_candidates.id;


--
-- Name: opportunity_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_clusters (
    id text NOT NULL,
    canonical_reader_task_id text NOT NULL,
    semantic_fingerprint text NOT NULL,
    clustering_version text NOT NULL,
    status text NOT NULL,
    canonical_audience text NOT NULL,
    canonical_situation text NOT NULL,
    canonical_problem text NOT NULL,
    canonical_question text NOT NULL,
    canonical_decision text NOT NULL,
    canonical_intent text NOT NULL,
    canonical_desired_outcome text NOT NULL,
    merged_evidence_summary text DEFAULT ''::text NOT NULL,
    similarity_explanation text DEFAULT ''::text NOT NULL,
    merge_confidence double precision DEFAULT 0 NOT NULL,
    requires_manual_review boolean DEFAULT false NOT NULL,
    demand_status text DEFAULT 'unavailable'::text NOT NULL,
    confidence text DEFAULT 'unknown'::text NOT NULL,
    wording_variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    conflicts jsonb DEFAULT '[]'::jsonb NOT NULL,
    supporting_evidence_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    payload jsonb NOT NULL,
    material_hash text NOT NULL,
    schema_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT opportunity_clusters_status_check CHECK ((status = ANY (ARRAY['active'::text, 'needs_review'::text, 'superseded'::text, 'split'::text, 'merged_away'::text])))
);


--
-- Name: owner_console_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_console_preferences (
    singleton boolean DEFAULT true NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT owner_console_preferences_singleton_check CHECK (singleton)
);


--
-- Name: pillar_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pillar_usage (
    id bigint NOT NULL,
    pillar text NOT NULL,
    subcategory text DEFAULT ''::text NOT NULL,
    audience text NOT NULL,
    format text NOT NULL,
    primary_keyword text DEFAULT ''::text NOT NULL,
    article_id bigint,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pillar_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pillar_usage_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pillar_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pillar_usage_id_seq OWNED BY public.pillar_usage.id;


--
-- Name: publish_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publish_jobs (
    id bigint NOT NULL,
    slot_key text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    article jsonb,
    article_id bigint,
    shopify_article_id text,
    shopify_url text,
    shopify_blog_id text,
    shopify_response_status text,
    error text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT publish_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'published'::text, 'failed'::text, 'skipped'::text, 'cancelled'::text])))
);


--
-- Name: publish_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.publish_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: publish_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.publish_jobs_id_seq OWNED BY public.publish_jobs.id;


--
-- Name: reader_task_cluster_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reader_task_cluster_history (
    id bigint NOT NULL,
    reader_task_id text NOT NULL,
    cluster_id text NOT NULL,
    action text NOT NULL,
    is_canonical boolean DEFAULT false NOT NULL,
    clustering_version text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reader_task_cluster_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reader_task_cluster_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reader_task_cluster_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reader_task_cluster_history_id_seq OWNED BY public.reader_task_cluster_history.id;


--
-- Name: reader_task_rejections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reader_task_rejections (
    id bigint NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    supporting_evidence_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reader_task_rejections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reader_task_rejections_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reader_task_rejections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reader_task_rejections_id_seq OWNED BY public.reader_task_rejections.id;


--
-- Name: reader_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reader_tasks (
    id text NOT NULL,
    payload jsonb NOT NULL,
    semantic_fingerprint text NOT NULL,
    demand_status text NOT NULL,
    normalization_status text NOT NULL,
    rejection_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    schema_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reader_tasks_normalization_status_check CHECK ((normalization_status = ANY (ARRAY['accepted'::text, 'rejected'::text])))
);


--
-- Name: research_cycle_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_cycle_runs (
    id bigint NOT NULL,
    slot_key text NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    decision text DEFAULT 'RUNNING'::text NOT NULL,
    reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
    opportunity_id text,
    brief_id bigint,
    article_id bigint,
    mode text DEFAULT 'draft_only'::text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_cycle_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: research_cycle_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_cycle_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_cycle_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_cycle_runs_id_seq OWNED BY public.research_cycle_runs.id;


--
-- Name: research_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_cycles (
    id bigint NOT NULL,
    collected_at timestamp with time zone NOT NULL,
    missing_providers jsonb DEFAULT '[]'::jsonb NOT NULL,
    signal_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: research_cycles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_cycles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_cycles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_cycles_id_seq OWNED BY public.research_cycles.id;


--
-- Name: research_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_opportunities (
    id text NOT NULL,
    cycle_id bigint,
    payload jsonb NOT NULL,
    status text DEFAULT 'suggested'::text NOT NULL,
    reserved_by text,
    reserved_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT research_opportunities_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'reserved'::text, 'approved'::text, 'rejected'::text, 'used'::text])))
);


--
-- Name: research_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_signals (
    id bigint NOT NULL,
    cycle_id bigint,
    provider text NOT NULL,
    collected_at timestamp with time zone NOT NULL,
    keyword text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: research_signals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_signals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_signals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_signals_id_seq OWNED BY public.research_signals.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    id text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    shop text,
    user_label text NOT NULL,
    auth_mode text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: source_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_evidence (
    id text NOT NULL,
    provider text NOT NULL,
    provider_version text NOT NULL,
    source_type text NOT NULL,
    source_reference text NOT NULL,
    collected_at timestamp with time zone NOT NULL,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    geographic_relevance text,
    normalized_problem text NOT NULL,
    normalized_question text NOT NULL,
    evidence_summary text NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence text NOT NULL,
    freshness text NOT NULL,
    provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    payload jsonb NOT NULL,
    schema_version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    approval_state text DEFAULT 'PENDING_APPROVAL'::text NOT NULL,
    approved_by text,
    approved_at timestamp with time zone,
    approval_method text,
    content_hash text,
    public_usage_allowed boolean DEFAULT false NOT NULL,
    usage_scope text,
    revoked_at timestamp with time zone,
    revoked_by text,
    revoke_reason text,
    material_hash text
);


--
-- Name: source_evidence_reader_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_evidence_reader_tasks (
    source_evidence_id text NOT NULL,
    reader_task_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: source_ingestion_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_ingestion_runs (
    id bigint NOT NULL,
    provider text NOT NULL,
    available boolean NOT NULL,
    reason text,
    collected_at timestamp with time zone NOT NULL,
    inserted_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    unchanged_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: source_ingestion_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.source_ingestion_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: source_ingestion_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.source_ingestion_runs_id_seq OWNED BY public.source_ingestion_runs.id;


--
-- Name: article_briefs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_briefs ALTER COLUMN id SET DEFAULT nextval('public.article_briefs_id_seq'::regclass);


--
-- Name: articles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles ALTER COLUMN id SET DEFAULT nextval('public.articles_id_seq'::regclass);


--
-- Name: audit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events ALTER COLUMN id SET DEFAULT nextval('public.audit_events_id_seq'::regclass);


--
-- Name: clustering_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clustering_runs ALTER COLUMN id SET DEFAULT nextval('public.clustering_runs_id_seq'::regclass);


--
-- Name: evidence_approval_audits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_approval_audits ALTER COLUMN id SET DEFAULT nextval('public.evidence_approval_audits_id_seq'::regclass);


--
-- Name: evidence_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports ALTER COLUMN id SET DEFAULT nextval('public.evidence_reports_id_seq'::regclass);


--
-- Name: knowledge_approvals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_approvals ALTER COLUMN id SET DEFAULT nextval('public.knowledge_approvals_id_seq'::regclass);


--
-- Name: knowledge_audit_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_audit_events ALTER COLUMN id SET DEFAULT nextval('public.knowledge_audit_events_id_seq'::regclass);


--
-- Name: knowledge_evaluation_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_evaluation_runs ALTER COLUMN id SET DEFAULT nextval('public.knowledge_evaluation_runs_id_seq'::regclass);


--
-- Name: merchant_interviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interviews ALTER COLUMN id SET DEFAULT nextval('public.merchant_interviews_id_seq'::regclass);


--
-- Name: merchant_knowledge id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_knowledge ALTER COLUMN id SET DEFAULT nextval('public.merchant_knowledge_id_seq'::regclass);


--
-- Name: opportunity_cluster_audits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_audits ALTER COLUMN id SET DEFAULT nextval('public.opportunity_cluster_audits_id_seq'::regclass);


--
-- Name: opportunity_cluster_review_candidates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_review_candidates ALTER COLUMN id SET DEFAULT nextval('public.opportunity_cluster_review_candidates_id_seq'::regclass);


--
-- Name: pillar_usage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pillar_usage ALTER COLUMN id SET DEFAULT nextval('public.pillar_usage_id_seq'::regclass);


--
-- Name: publish_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_jobs ALTER COLUMN id SET DEFAULT nextval('public.publish_jobs_id_seq'::regclass);


--
-- Name: reader_task_cluster_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reader_task_cluster_history ALTER COLUMN id SET DEFAULT nextval('public.reader_task_cluster_history_id_seq'::regclass);


--
-- Name: reader_task_rejections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reader_task_rejections ALTER COLUMN id SET DEFAULT nextval('public.reader_task_rejections_id_seq'::regclass);


--
-- Name: research_cycle_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cycle_runs ALTER COLUMN id SET DEFAULT nextval('public.research_cycle_runs_id_seq'::regclass);


--
-- Name: research_cycles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cycles ALTER COLUMN id SET DEFAULT nextval('public.research_cycles_id_seq'::regclass);


--
-- Name: research_signals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_signals ALTER COLUMN id SET DEFAULT nextval('public.research_signals_id_seq'::regclass);


--
-- Name: source_ingestion_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_ingestion_runs ALTER COLUMN id SET DEFAULT nextval('public.source_ingestion_runs_id_seq'::regclass);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (singleton);


--
-- Name: article_briefs article_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_briefs
    ADD CONSTRAINT article_briefs_pkey PRIMARY KEY (id);


--
-- Name: articles articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: cluster_claim_requirements cluster_claim_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cluster_claim_requirements
    ADD CONSTRAINT cluster_claim_requirements_pkey PRIMARY KEY (id);


--
-- Name: cluster_evidence_budgets cluster_evidence_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cluster_evidence_budgets
    ADD CONSTRAINT cluster_evidence_budgets_pkey PRIMARY KEY (cluster_id);


--
-- Name: clustering_runs clustering_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clustering_runs
    ADD CONSTRAINT clustering_runs_pkey PRIMARY KEY (id);


--
-- Name: evidence_approval_audits evidence_approval_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_approval_audits
    ADD CONSTRAINT evidence_approval_audits_pkey PRIMARY KEY (id);


--
-- Name: evidence_reports evidence_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports
    ADD CONSTRAINT evidence_reports_pkey PRIMARY KEY (id);


--
-- Name: knowledge_approvals knowledge_approvals_entry_id_revision_id_content_hash_appro_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_approvals
    ADD CONSTRAINT knowledge_approvals_entry_id_revision_id_content_hash_appro_key UNIQUE (entry_id, revision_id, content_hash, approval_state, approved_at);


--
-- Name: knowledge_approvals knowledge_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_approvals
    ADD CONSTRAINT knowledge_approvals_pkey PRIMARY KEY (id);


--
-- Name: knowledge_audit_events knowledge_audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_audit_events
    ADD CONSTRAINT knowledge_audit_events_pkey PRIMARY KEY (id);


--
-- Name: knowledge_claims knowledge_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_claims
    ADD CONSTRAINT knowledge_claims_pkey PRIMARY KEY (id);


--
-- Name: knowledge_entries knowledge_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_entries
    ADD CONSTRAINT knowledge_entries_pkey PRIMARY KEY (id);


--
-- Name: knowledge_entry_revisions knowledge_entry_revisions_entry_id_content_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_entry_revisions
    ADD CONSTRAINT knowledge_entry_revisions_entry_id_content_hash_key UNIQUE (entry_id, content_hash);


--
-- Name: knowledge_entry_revisions knowledge_entry_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_entry_revisions
    ADD CONSTRAINT knowledge_entry_revisions_pkey PRIMARY KEY (revision_id);


--
-- Name: knowledge_evaluation_runs knowledge_evaluation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_evaluation_runs
    ADD CONSTRAINT knowledge_evaluation_runs_pkey PRIMARY KEY (id);


--
-- Name: knowledge_source_links knowledge_source_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_source_links
    ADD CONSTRAINT knowledge_source_links_pkey PRIMARY KEY (entry_id, source_evidence_id);


--
-- Name: merchant_interview_answers merchant_interview_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interview_answers
    ADD CONSTRAINT merchant_interview_answers_pkey PRIMARY KEY (packet_id, question_id);


--
-- Name: merchant_interview_packets merchant_interview_packets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interview_packets
    ADD CONSTRAINT merchant_interview_packets_pkey PRIMARY KEY (id);


--
-- Name: merchant_interview_questions merchant_interview_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interview_questions
    ADD CONSTRAINT merchant_interview_questions_pkey PRIMARY KEY (id);


--
-- Name: merchant_interviews merchant_interviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interviews
    ADD CONSTRAINT merchant_interviews_pkey PRIMARY KEY (id);


--
-- Name: merchant_knowledge merchant_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_knowledge
    ADD CONSTRAINT merchant_knowledge_pkey PRIMARY KEY (id);


--
-- Name: opportunity_cluster_audits opportunity_cluster_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_audits
    ADD CONSTRAINT opportunity_cluster_audits_pkey PRIMARY KEY (id);


--
-- Name: opportunity_cluster_evidence opportunity_cluster_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_evidence
    ADD CONSTRAINT opportunity_cluster_evidence_pkey PRIMARY KEY (cluster_id, source_evidence_id);


--
-- Name: opportunity_cluster_members opportunity_cluster_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_members
    ADD CONSTRAINT opportunity_cluster_members_pkey PRIMARY KEY (cluster_id, reader_task_id);


--
-- Name: opportunity_cluster_review_candidates opportunity_cluster_review_ca_left_reader_task_id_right_rea_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_review_candidates
    ADD CONSTRAINT opportunity_cluster_review_ca_left_reader_task_id_right_rea_key UNIQUE (left_reader_task_id, right_reader_task_id, clustering_version);


--
-- Name: opportunity_cluster_review_candidates opportunity_cluster_review_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_review_candidates
    ADD CONSTRAINT opportunity_cluster_review_candidates_pkey PRIMARY KEY (id);


--
-- Name: opportunity_clusters opportunity_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_clusters
    ADD CONSTRAINT opportunity_clusters_pkey PRIMARY KEY (id);


--
-- Name: owner_console_preferences owner_console_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_console_preferences
    ADD CONSTRAINT owner_console_preferences_pkey PRIMARY KEY (singleton);


--
-- Name: pillar_usage pillar_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pillar_usage
    ADD CONSTRAINT pillar_usage_pkey PRIMARY KEY (id);


--
-- Name: publish_jobs publish_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_jobs
    ADD CONSTRAINT publish_jobs_pkey PRIMARY KEY (id);


--
-- Name: publish_jobs publish_jobs_slot_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_jobs
    ADD CONSTRAINT publish_jobs_slot_key_key UNIQUE (slot_key);


--
-- Name: reader_task_cluster_history reader_task_cluster_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reader_task_cluster_history
    ADD CONSTRAINT reader_task_cluster_history_pkey PRIMARY KEY (id);


--
-- Name: reader_task_rejections reader_task_rejections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reader_task_rejections
    ADD CONSTRAINT reader_task_rejections_pkey PRIMARY KEY (id);


--
-- Name: reader_tasks reader_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reader_tasks
    ADD CONSTRAINT reader_tasks_pkey PRIMARY KEY (id);


--
-- Name: research_cycle_runs research_cycle_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cycle_runs
    ADD CONSTRAINT research_cycle_runs_pkey PRIMARY KEY (id);


--
-- Name: research_cycle_runs research_cycle_runs_slot_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cycle_runs
    ADD CONSTRAINT research_cycle_runs_slot_key_key UNIQUE (slot_key);


--
-- Name: research_cycles research_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cycles
    ADD CONSTRAINT research_cycles_pkey PRIMARY KEY (id);


--
-- Name: research_opportunities research_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_opportunities
    ADD CONSTRAINT research_opportunities_pkey PRIMARY KEY (id);


--
-- Name: research_signals research_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_signals
    ADD CONSTRAINT research_signals_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: source_evidence source_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_evidence
    ADD CONSTRAINT source_evidence_pkey PRIMARY KEY (id);


--
-- Name: source_evidence source_evidence_provider_source_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_evidence
    ADD CONSTRAINT source_evidence_provider_source_reference_key UNIQUE (provider, source_reference);


--
-- Name: source_evidence_reader_tasks source_evidence_reader_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_evidence_reader_tasks
    ADD CONSTRAINT source_evidence_reader_tasks_pkey PRIMARY KEY (source_evidence_id, reader_task_id);


--
-- Name: source_ingestion_runs source_ingestion_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_ingestion_runs
    ADD CONSTRAINT source_ingestion_runs_pkey PRIMARY KEY (id);


--
-- Name: article_briefs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX article_briefs_status_idx ON public.article_briefs USING btree (status, updated_at DESC);


--
-- Name: articles_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX articles_idempotency_uidx ON public.articles USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: articles_scheduled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_scheduled_idx ON public.articles USING btree (status, scheduled_for);


--
-- Name: articles_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_search_idx ON public.articles USING gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(excerpt, ''::text))));


--
-- Name: articles_shopify_article_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX articles_shopify_article_uidx ON public.articles USING btree (shopify_article_id) WHERE (shopify_article_id IS NOT NULL);


--
-- Name: articles_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_status_idx ON public.articles USING btree (status, updated_at DESC);


--
-- Name: audit_events_article_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_article_idx ON public.audit_events USING btree (article_id, created_at DESC);


--
-- Name: audit_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_created_idx ON public.audit_events USING btree (created_at DESC);


--
-- Name: audit_events_rollout_draft_counted_article_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX audit_events_rollout_draft_counted_article_uidx ON public.audit_events USING btree (article_id) WHERE ((action = 'rollout_draft_counted'::text) AND (article_id IS NOT NULL));


--
-- Name: cluster_claim_requirements_cluster_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cluster_claim_requirements_cluster_idx ON public.cluster_claim_requirements USING btree (cluster_id, support_status);


--
-- Name: cluster_evidence_budgets_readiness_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cluster_evidence_budgets_readiness_idx ON public.cluster_evidence_budgets USING btree (readiness_status);


--
-- Name: clustering_runs_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clustering_runs_created_idx ON public.clustering_runs USING btree (created_at DESC);


--
-- Name: evidence_approval_audits_evidence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evidence_approval_audits_evidence_idx ON public.evidence_approval_audits USING btree (source_evidence_id, created_at DESC);


--
-- Name: evidence_reports_article_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evidence_reports_article_idx ON public.evidence_reports USING btree (article_id, created_at DESC);


--
-- Name: knowledge_approvals_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_approvals_entry_idx ON public.knowledge_approvals USING btree (entry_id, created_at DESC);


--
-- Name: knowledge_audit_events_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_audit_events_entry_idx ON public.knowledge_audit_events USING btree (entry_id, created_at DESC);


--
-- Name: knowledge_claims_cluster_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_claims_cluster_idx ON public.knowledge_claims USING btree (cluster_id);


--
-- Name: knowledge_entries_approval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_entries_approval_idx ON public.knowledge_entries USING btree (approval_state);


--
-- Name: knowledge_entries_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_entries_class_idx ON public.knowledge_entries USING btree (knowledge_class);


--
-- Name: knowledge_entries_content_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX knowledge_entries_content_hash_uidx ON public.knowledge_entries USING btree (id, content_hash);


--
-- Name: knowledge_entries_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_entries_source_type_idx ON public.knowledge_entries USING btree (source_type);


--
-- Name: knowledge_entry_revisions_entry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_entry_revisions_entry_idx ON public.knowledge_entry_revisions USING btree (entry_id, created_at DESC);


--
-- Name: knowledge_evaluation_runs_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_evaluation_runs_created_idx ON public.knowledge_evaluation_runs USING btree (created_at DESC);


--
-- Name: knowledge_evaluation_runs_material_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_evaluation_runs_material_idx ON public.knowledge_evaluation_runs USING btree (material_hash);


--
-- Name: merchant_interview_packets_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merchant_interview_packets_class_idx ON public.merchant_interview_packets USING btree (knowledge_class, completion_status);


--
-- Name: merchant_interview_questions_packet_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merchant_interview_questions_packet_idx ON public.merchant_interview_questions USING btree (packet_id);


--
-- Name: merchant_interviews_brief_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merchant_interviews_brief_idx ON public.merchant_interviews USING btree (brief_id);


--
-- Name: merchant_knowledge_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merchant_knowledge_class_idx ON public.merchant_knowledge USING btree (topic_class);


--
-- Name: opportunity_cluster_audits_cluster_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_cluster_audits_cluster_idx ON public.opportunity_cluster_audits USING btree (cluster_id, created_at);


--
-- Name: opportunity_cluster_members_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_cluster_members_active_idx ON public.opportunity_cluster_members USING btree (cluster_id, active);


--
-- Name: opportunity_cluster_members_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_cluster_members_task_idx ON public.opportunity_cluster_members USING btree (reader_task_id, active);


--
-- Name: opportunity_cluster_review_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_cluster_review_version_idx ON public.opportunity_cluster_review_candidates USING btree (clustering_version);


--
-- Name: opportunity_clusters_canonical_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_clusters_canonical_idx ON public.opportunity_clusters USING btree (canonical_reader_task_id);


--
-- Name: opportunity_clusters_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_clusters_status_idx ON public.opportunity_clusters USING btree (status, updated_at DESC);


--
-- Name: opportunity_clusters_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opportunity_clusters_version_idx ON public.opportunity_clusters USING btree (clustering_version);


--
-- Name: pillar_usage_pillar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pillar_usage_pillar_idx ON public.pillar_usage USING btree (pillar, used_at DESC);


--
-- Name: pillar_usage_used_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pillar_usage_used_idx ON public.pillar_usage USING btree (used_at DESC);


--
-- Name: publish_jobs_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX publish_jobs_due_idx ON public.publish_jobs USING btree (status, next_attempt_at, scheduled_for);


--
-- Name: publish_jobs_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX publish_jobs_idempotency_uidx ON public.publish_jobs USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: reader_task_cluster_history_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reader_task_cluster_history_task_idx ON public.reader_task_cluster_history USING btree (reader_task_id, created_at DESC);


--
-- Name: reader_task_rejections_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reader_task_rejections_created_idx ON public.reader_task_rejections USING btree (created_at DESC);


--
-- Name: reader_tasks_fingerprint_accepted_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reader_tasks_fingerprint_accepted_uidx ON public.reader_tasks USING btree (semantic_fingerprint) WHERE (normalization_status = 'accepted'::text);


--
-- Name: reader_tasks_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reader_tasks_fingerprint_idx ON public.reader_tasks USING btree (semantic_fingerprint);


--
-- Name: reader_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reader_tasks_status_idx ON public.reader_tasks USING btree (normalization_status, updated_at DESC);


--
-- Name: research_cycle_runs_collected_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_cycle_runs_collected_idx ON public.research_cycle_runs USING btree (collected_at DESC);


--
-- Name: research_opportunities_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_opportunities_status_idx ON public.research_opportunities USING btree (status, updated_at DESC);


--
-- Name: research_signals_cycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_signals_cycle_idx ON public.research_signals USING btree (cycle_id);


--
-- Name: research_signals_keyword_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX research_signals_keyword_idx ON public.research_signals USING btree (keyword);


--
-- Name: sessions_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_expires_idx ON public.sessions USING btree (expires_at);


--
-- Name: source_evidence_approval_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_evidence_approval_state_idx ON public.source_evidence USING btree (approval_state);


--
-- Name: source_evidence_collected_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_evidence_collected_idx ON public.source_evidence USING btree (collected_at DESC);


--
-- Name: source_evidence_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_evidence_type_idx ON public.source_evidence USING btree (source_type);


--
-- Name: source_ingestion_runs_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_ingestion_runs_provider_idx ON public.source_ingestion_runs USING btree (provider, collected_at DESC);


--
-- Name: article_briefs article_briefs_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_briefs
    ADD CONSTRAINT article_briefs_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: article_briefs article_briefs_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_briefs
    ADD CONSTRAINT article_briefs_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.research_opportunities(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.publish_jobs(id) ON DELETE SET NULL;


--
-- Name: evidence_approval_audits evidence_approval_audits_source_evidence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_approval_audits
    ADD CONSTRAINT evidence_approval_audits_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.source_evidence(id) ON DELETE CASCADE;


--
-- Name: evidence_reports evidence_reports_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports
    ADD CONSTRAINT evidence_reports_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;


--
-- Name: evidence_reports evidence_reports_brief_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_reports
    ADD CONSTRAINT evidence_reports_brief_id_fkey FOREIGN KEY (brief_id) REFERENCES public.article_briefs(id) ON DELETE SET NULL;


--
-- Name: knowledge_approvals knowledge_approvals_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_approvals
    ADD CONSTRAINT knowledge_approvals_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id) ON DELETE CASCADE;


--
-- Name: knowledge_entry_revisions knowledge_entry_revisions_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_entry_revisions
    ADD CONSTRAINT knowledge_entry_revisions_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id) ON DELETE CASCADE;


--
-- Name: knowledge_source_links knowledge_source_links_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_source_links
    ADD CONSTRAINT knowledge_source_links_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id) ON DELETE CASCADE;


--
-- Name: merchant_interview_answers merchant_interview_answers_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interview_answers
    ADD CONSTRAINT merchant_interview_answers_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES public.knowledge_entries(id) ON DELETE SET NULL;


--
-- Name: merchant_interview_answers merchant_interview_answers_packet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interview_answers
    ADD CONSTRAINT merchant_interview_answers_packet_id_fkey FOREIGN KEY (packet_id) REFERENCES public.merchant_interview_packets(id) ON DELETE CASCADE;


--
-- Name: merchant_interview_answers merchant_interview_answers_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interview_answers
    ADD CONSTRAINT merchant_interview_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.merchant_interview_questions(id) ON DELETE CASCADE;


--
-- Name: merchant_interview_questions merchant_interview_questions_packet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interview_questions
    ADD CONSTRAINT merchant_interview_questions_packet_id_fkey FOREIGN KEY (packet_id) REFERENCES public.merchant_interview_packets(id) ON DELETE CASCADE;


--
-- Name: merchant_interviews merchant_interviews_brief_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_interviews
    ADD CONSTRAINT merchant_interviews_brief_id_fkey FOREIGN KEY (brief_id) REFERENCES public.article_briefs(id) ON DELETE CASCADE;


--
-- Name: opportunity_cluster_audits opportunity_cluster_audits_cluster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_audits
    ADD CONSTRAINT opportunity_cluster_audits_cluster_id_fkey FOREIGN KEY (cluster_id) REFERENCES public.opportunity_clusters(id) ON DELETE CASCADE;


--
-- Name: opportunity_cluster_evidence opportunity_cluster_evidence_cluster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_evidence
    ADD CONSTRAINT opportunity_cluster_evidence_cluster_id_fkey FOREIGN KEY (cluster_id) REFERENCES public.opportunity_clusters(id) ON DELETE CASCADE;


--
-- Name: opportunity_cluster_members opportunity_cluster_members_cluster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_members
    ADD CONSTRAINT opportunity_cluster_members_cluster_id_fkey FOREIGN KEY (cluster_id) REFERENCES public.opportunity_clusters(id) ON DELETE CASCADE;


--
-- Name: opportunity_cluster_members opportunity_cluster_members_reader_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_cluster_members
    ADD CONSTRAINT opportunity_cluster_members_reader_task_id_fkey FOREIGN KEY (reader_task_id) REFERENCES public.reader_tasks(id) ON DELETE CASCADE;


--
-- Name: pillar_usage pillar_usage_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pillar_usage
    ADD CONSTRAINT pillar_usage_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: publish_jobs publish_jobs_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publish_jobs
    ADD CONSTRAINT publish_jobs_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: reader_task_cluster_history reader_task_cluster_history_reader_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reader_task_cluster_history
    ADD CONSTRAINT reader_task_cluster_history_reader_task_id_fkey FOREIGN KEY (reader_task_id) REFERENCES public.reader_tasks(id) ON DELETE CASCADE;


--
-- Name: research_cycle_runs research_cycle_runs_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cycle_runs
    ADD CONSTRAINT research_cycle_runs_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: research_cycle_runs research_cycle_runs_brief_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cycle_runs
    ADD CONSTRAINT research_cycle_runs_brief_id_fkey FOREIGN KEY (brief_id) REFERENCES public.article_briefs(id) ON DELETE SET NULL;


--
-- Name: research_opportunities research_opportunities_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_opportunities
    ADD CONSTRAINT research_opportunities_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.research_cycles(id) ON DELETE SET NULL;


--
-- Name: research_signals research_signals_cycle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_signals
    ADD CONSTRAINT research_signals_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.research_cycles(id) ON DELETE CASCADE;


--
-- Name: source_evidence_reader_tasks source_evidence_reader_tasks_reader_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_evidence_reader_tasks
    ADD CONSTRAINT source_evidence_reader_tasks_reader_task_id_fkey FOREIGN KEY (reader_task_id) REFERENCES public.reader_tasks(id) ON DELETE CASCADE;


--
-- Name: source_evidence_reader_tasks source_evidence_reader_tasks_source_evidence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_evidence_reader_tasks
    ADD CONSTRAINT source_evidence_reader_tasks_source_evidence_id_fkey FOREIGN KEY (source_evidence_id) REFERENCES public.source_evidence(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 4zsdjEpKYCBU1XVwSPiwmGIQ5XeKluDZxXldbz39SdneFCTKEFtH4rPovRw2wL5

