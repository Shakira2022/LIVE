-- Extend the existing PostgreSQL enum to support the three response types
-- used by organisation creation, editing, and category-aware routing.
-- Run this migration before creating or recategorising organisations with
-- these values. Legacy values remain available for existing rows.

ALTER TYPE public.organisation_type ADD VALUE IF NOT EXISTS 'medical';
ALTER TYPE public.organisation_type ADD VALUE IF NOT EXISTS 'firefighter';
ALTER TYPE public.organisation_type ADD VALUE IF NOT EXISTS 'police';
