/*
 * F13 Campaigns (WP4): shared pieces for the campaign screens: kinds, status
 * pills, date lines and the phase colours. No side effects.
 */
import { addDays, daysBetween, fmtDay, fmtMoney, fmtShort, h, icon, todayLondon } from './core.js';

export const enc = encodeURIComponent;
export const COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];

/** Activity kinds: label and glyph. */
export const KIND = {
  task: ['Task', 'task_alt'], workout: ['Workout', 'fitness_center'], habit: ['Habit', 'self_improvement'], checkin: ['Check-in', 'edit_note'],
  read: ['Read', 'auto_stories'], purchase: ['Buy', 'shopping_bag'], session: ['Session', 'event_available'], measure: ['Measure', 'straighten'], custom: ['Custom', 'star'],
};
export const kindBadge = (kind, size = 16) => h('span', { class: `cg-kind k-${kind}`, title: KIND[kind]?.[0] ?? kind, 'aria-hidden': 'true' }, icon(KIND[kind]?.[1] ?? 'star', size));

const STATUS = { draft: ['Draft', 'edit_note'], live: ['Live', 'play_circle'], ended: ['Ended', 'sports_score'], archived: ['Archived', 'archive'] };
/** A campaign's status: word and glyph, never colour alone. */
export const statusPill = s => h('span', { class: `cg-status s-${s}` }, icon(STATUS[s]?.[1] ?? 'edit_note', 14), STATUS[s]?.[0] ?? s);

const ENROL = {
  invited: ['Invited', 'mail'], waitlisted: ['Waitlisted', 'hourglass_empty'], declined: ['Declined', 'block'], active: ['Active', 'play_circle'],
  paused: ['Paused', 'pause_circle'], completed: ['Completed', 'celebration'], dropped: ['Left', 'logout'],
};
export const enrolPill = s => h('span', { class: `cg-epill e-${s}` }, icon(ENROL[s]?.[1] ?? 'flag', 13), ENROL[s]?.[0] ?? s);

export const money = p => fmtMoney(p ?? 0);
export const weeksWord = days => (days % 7 === 0 ? `${days / 7} week${days === 7 ? '' : 's'}` : `${days} days`);
export const endOf = c => (c.startsOn ? addDays(c.startsOn, c.lengthDays - 1) : null);
/** "1 Nov – 23 Jan · 12 weeks" or "Rolling · 30 days". */
export const datesLine = c => (c.startMode === 'fixed'
  ? (c.startsOn ? `${fmtShort(c.startsOn)} – ${fmtShort(endOf(c))} · ${weeksWord(c.lengthDays)}` : `No start date yet · ${weeksWord(c.lengthDays)}`)
  : `Rolling start · ${weeksWord(c.lengthDays)}`);
/** The calendar day of a campaign day (fixed campaigns only). */
export const dayDate = (c, day) => (c.startMode === 'fixed' && c.startsOn ? fmtDay(addDays(c.startsOn, day)) : null);
/** Today's 0-based day of a live fixed campaign, or null. */
export const todayIndex = c => {
  if (c.startMode !== 'fixed' || !c.startsOn) return null;
  const i = daysBetween(c.startsOn, todayLondon());
  return i >= 0 && i < c.lengthDays ? i : null;
};
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
