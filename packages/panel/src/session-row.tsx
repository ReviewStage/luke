import React from "react";
import { BranchGlyph, CheckGlyph } from "./glyphs.js";
import { AudioBadge, CloudBadge, ProviderMark } from "./provider-marks.js";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

export interface SessionRowProps {
  providerId: string;
  cloud?: boolean;
  realtimeVoice?: boolean;
  markName?: string;
  model?: string;
  title: React.ReactNode;
  detail: React.ReactNode;
  detailTitle?: string;
  detailPrefix?: React.ReactNode;
  working?: boolean;
  complete?: boolean;
  place?: React.ReactNode;
  placeTitle?: string;
  branch?: boolean;
  diff?: React.ReactNode;
  when: React.ReactNode;
  notice?: React.ReactNode;
  applications?: React.ReactNode;
}

/** The shared visual anatomy of a session row; each app owns its interaction shell. */
export function SessionRow({
  providerId,
  cloud = false,
  realtimeVoice = false,
  markName,
  model,
  title,
  detail,
  detailTitle,
  detailPrefix,
  working = false,
  complete = false,
  place,
  placeTitle,
  branch = false,
  diff,
  when,
  notice,
  applications,
}: SessionRowProps): React.JSX.Element {
  return (
    <>
      <span
        className={realtimeVoice && cloud ? "row-mark row-mark-audio" : "row-mark"}
        title={markName ? (model ? `${markName} · ${model}` : markName) : undefined}
      >
        {markName ? <span className="visually-hidden">{markName}</span> : null}
        <ProviderMark providerId={providerId} />
        {cloud ? <CloudBadge /> : null}
        {realtimeVoice ? <AudioBadge /> : null}
      </span>
      <span className="row-copy">
        <strong>{title}</strong>
        <small className="row-doing">
          {working ? <span className="row-spinner" aria-hidden="true" /> : null}
          {complete ? <CheckGlyph /> : null}
          <span className="row-doing-text" title={detailTitle}>
            {detailPrefix}
            {detail}
          </span>
        </small>
        {place || diff ? (
          <small className="row-place" title={placeTitle}>
            {branch ? <BranchGlyph /> : null}
            {place ? <span>{place}</span> : null}
            {diff ? <span className="row-diff">{diff}</span> : null}
          </small>
        ) : null}
      </span>
      <span className="row-side">
        <small className="row-when">
          {notice}
          {when}
        </small>
        {applications}
      </span>
    </>
  );
}
