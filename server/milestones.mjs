import { dayStates } from './daily.mjs';
import { activeGoalRow, goalOut } from './goals.mjs';
import { progressOf } from './progress.mjs';
import { hasFeature } from './settings.mjs';
import { addDays, daysBetween, londonDay } from './time.mjs';

/**
 * Milestones the server spots and suggests to JK as a letter: goal reached,
 * a first personal best, four weeks at the minimum, twelve weeks on plan. They
 * become letters only when JK writes them (kind "milestone", with the key), and
 * a key that already has a letter is never suggested again. Plans with
 * 'checkin' only, since milestones arrive as letters.
 */
export function milestoneSuggestions(db, client, today = londonDay()) {
  if (!hasFeature(db, client, 'checkin')) return [];
  const first = client.name.split(' ')[0];
  const written = new Set(db.prepare('SELECT milestone_key k FROM reports WHERE client_id=? AND milestone_key IS NOT NULL').all(client.id).map(r => r.k));
  const out = [];
  const add = (key, reason, headline) => { if (!written.has(key)) out.push({ key, reason, suggestedHeadline: headline }); };

  const goal = activeGoalRow(db, client.id);
  if (goal) {
    const g = goalOut(db, goal, today);
    if (g.reached) add(`goalReached:${goal.id}`, `${first}: goal reached`, `${g.title}. Done.`);
  }
  const record = progressOf(db, client, 'all').records.find(r => r.isNewThisWeek);
  if (record) add('firstRecord', `${first}: a new best, ${record.exercise} ${record.kg} kg`, `New best. ${record.exercise}, ${record.kg} kg.`);
  const states = dayStates(db, client, addDays(today, -28), addDays(today, -1), { useHealth: true, today });
  const counted = states.filter(s => !s.rest && s.total > 0);
  if (counted.length >= 20 && counted.every(s => s.done)) add('fourWeeksMinimum', `${first}: four weeks at the minimum`, 'Four weeks without missing your minimum.');
  const since = (client.plan_since ?? client.created_at).slice(0, 10);
  const onPlan = daysBetween(since, today);
  if (client.plan !== 'none' && onPlan >= 84 && onPlan < 84 + 28) add('twelveWeeks', `${first}: twelve weeks on plan`, 'Twelve weeks. You train like an athlete now.');
  return out;
}
