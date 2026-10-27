import { z } from "zod";

/**
 * Subset of the OSV schema (https://ossf.github.io/osv-schema/) that Gateseeker
 * reads. Everything else is kept through `looseObject` so the raw record can be
 * preserved as evidence. Unknown fields never cause a rejection; missing or
 * mistyped required fields do.
 */

export const osvRangeEventSchema = z.looseObject({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
  limit: z.string().optional(),
});

export const osvRangeSchema = z.looseObject({
  type: z.string(),
  events: z.array(osvRangeEventSchema),
});

export const osvAffectedSchema = z.looseObject({
  package: z
    .looseObject({
      name: z.string(),
      ecosystem: z.string(),
      purl: z.string().optional(),
    })
    .optional(),
  ranges: z.array(osvRangeSchema).optional(),
  versions: z.array(z.string()).optional(),
});

export const osvSeveritySchema = z.looseObject({
  type: z.string(),
  score: z.string(),
});

export const osvReferenceSchema = z.looseObject({
  type: z.string(),
  url: z.string(),
});

export const osvVulnerabilitySchema = z.looseObject({
  id: z.string().min(1),
  summary: z.string().optional(),
  details: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  modified: z.string().optional(),
  published: z.string().optional(),
  severity: z.array(osvSeveritySchema).optional(),
  affected: z.array(osvAffectedSchema).optional(),
  references: z.array(osvReferenceSchema).optional(),
  database_specific: z.looseObject({ severity: z.string().optional() }).optional(),
});

export const osvQueryResponseSchema = z.looseObject({
  vulns: z.array(osvVulnerabilitySchema).optional(),
  next_page_token: z.string().optional(),
});

export type OsvVulnerability = z.infer<typeof osvVulnerabilitySchema>;
export type OsvQueryResponse = z.infer<typeof osvQueryResponseSchema>;
