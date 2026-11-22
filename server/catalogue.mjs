/** Fixed reference data: the exercise library, coach guides. Plans are in plans.mjs. */

export const CATEGORIES = ['Legs', 'Push', 'Pull', 'Core', 'Mobility', 'Conditioning'];

// [name, equipment, pattern, category]
const LIBRARY = [
  ['Back Squat', 'Barbell', 'Squat', 'Legs'], ['Front Squat', 'Barbell', 'Squat', 'Legs'],
  ['Goblet Squat', 'Kettlebell', 'Squat', 'Legs'], ['Bulgarian Split Squat', 'Dumbbell', 'Lunge', 'Legs'],
  ['Walking Lunge', 'Dumbbell', 'Lunge', 'Legs'], ['Reverse Lunge', 'Bodyweight', 'Lunge', 'Legs'],
  ['Step-up', 'Dumbbell', 'Lunge', 'Legs'], ['Leg Press', 'Machine', 'Squat', 'Legs'],
  ['Deadlift', 'Barbell', 'Hinge', 'Pull'], ['Romanian Deadlift', 'Barbell', 'Hinge', 'Pull'],
  ['Trap Bar Deadlift', 'Trap bar', 'Hinge', 'Legs'], ['Hip Thrust', 'Barbell', 'Glutes', 'Legs'],
  ['Glute Bridge', 'Bodyweight', 'Glutes', 'Legs'], ['Kettlebell Swing', 'Kettlebell', 'Hinge', 'Conditioning'],
  ['Single-leg RDL', 'Dumbbell', 'Hinge', 'Legs'], ['Nordic Curl', 'Bodyweight', 'Hamstrings', 'Legs'],
  ['Leg Curl', 'Machine', 'Hamstrings', 'Legs'], ['Calf Raise', 'Machine', 'Calves', 'Legs'],
  ['Bench Press', 'Barbell', 'Horizontal push', 'Push'], ['Incline Dumbbell Press', 'Dumbbell', 'Horizontal push', 'Push'],
  ['Push-up', 'Bodyweight', 'Horizontal push', 'Push'], ['Overhead Press', 'Barbell', 'Vertical push', 'Push'],
  ['Seated Dumbbell Press', 'Dumbbell', 'Vertical push', 'Push'], ['Landmine Press', 'Barbell', 'Vertical push', 'Push'],
  ['Dip', 'Bodyweight', 'Vertical push', 'Push'], ['Cable Fly', 'Cable', 'Horizontal push', 'Push'],
  ['Lateral Raise', 'Dumbbell', 'Shoulders', 'Push'], ['Triceps Pushdown', 'Cable', 'Arms', 'Push'],
  ['Pull-up', 'Bodyweight', 'Vertical pull', 'Pull'], ['Chin-up', 'Bodyweight', 'Vertical pull', 'Pull'],
  ['Lat Pulldown', 'Cable', 'Vertical pull', 'Pull'], ['Barbell Row', 'Barbell', 'Horizontal pull', 'Pull'],
  ['Single-arm Dumbbell Row', 'Dumbbell', 'Horizontal pull', 'Pull'], ['Seated Cable Row', 'Cable', 'Horizontal pull', 'Pull'],
  ['Face Pull', 'Cable', 'Shoulders', 'Pull'], ['Inverted Row', 'Bodyweight', 'Horizontal pull', 'Pull'],
  ['Biceps Curl', 'Dumbbell', 'Arms', 'Pull'], ['Hammer Curl', 'Dumbbell', 'Arms', 'Pull'],
  ['Plank', 'Bodyweight', 'Anti-extension', 'Core'], ['Copenhagen Plank', 'Bodyweight', 'Adductors', 'Core'],
  ['Side Plank', 'Bodyweight', 'Anti-lateral', 'Core'], ['Dead Bug', 'Bodyweight', 'Anti-extension', 'Core'],
  ['Pallof Press', 'Cable', 'Anti-rotation', 'Core'], ['Hanging Leg Raise', 'Bodyweight', 'Flexion', 'Core'],
  ['Ab Wheel Rollout', 'Ab wheel', 'Anti-extension', 'Core'], ['Farmer Carry', 'Kettlebell', 'Carry', 'Core'],
  ['Suitcase Carry', 'Kettlebell', 'Carry', 'Core'], ['Bird Dog', 'Bodyweight', 'Stability', 'Core'],
  ['90/90 Hip Switch', 'Bodyweight', 'Hips', 'Mobility'], ['World\'s Greatest Stretch', 'Bodyweight', 'Full body', 'Mobility'],
  ['Couch Stretch', 'Bodyweight', 'Hips', 'Mobility'], ['Thoracic Rotation', 'Bodyweight', 'Spine', 'Mobility'],
  ['Ankle Rocks', 'Bodyweight', 'Ankles', 'Mobility'], ['Cat-Cow', 'Bodyweight', 'Spine', 'Mobility'],
  ['Rower', 'Machine', 'Cardio', 'Conditioning'], ['Assault Bike', 'Machine', 'Cardio', 'Conditioning'],
  ['Sled Push', 'Sled', 'Cardio', 'Conditioning'], ['Burpee', 'Bodyweight', 'Cardio', 'Conditioning'],
  ['Kettlebell Clean', 'Kettlebell', 'Power', 'Conditioning'], ['Box Jump', 'Box', 'Power', 'Conditioning'],
  ['Run', 'None', 'Cardio', 'Conditioning'], ['Turkish Get-up', 'Kettlebell', 'Full body', 'Core'],
];

export const exerciseId = name => 'ex_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function seedCatalogue(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO exercises (id, name, equipment, pattern, category) VALUES (?, ?, ?, ?, ?)');
  for (const [name, equipment, pattern, category] of LIBRARY) insert.run(exerciseId(name), name, equipment, pattern, category);
}

/** Every new client starts with these; the coach edits them per person. */
export const DEFAULT_HABITS = [
  { name: 'Water', kind: 'count', target: 3, unit: 'L', icon: 'drop', iconKey: 'water', healthKind: null },
  { name: 'Sleep 7h+', kind: 'check', target: 7, unit: 'h', icon: 'moon', iconKey: 'sleep', healthKind: 'sleep' },
  { name: 'Steps', kind: 'count', target: 10000, unit: 'steps', icon: 'shoeprints.fill', iconKey: 'steps', healthKind: 'steps' },
  { name: 'Creatine', kind: 'check', target: 1, unit: '', icon: 'bolt', iconKey: 'energy', healthKind: null },
];

export const DEFAULT_TARGETS = { kcal: 2500, protein: 170, carbs: 260, fat: 80 };

export const WELCOME_MESSAGE = "Welcome to JK Performance. Tell me a bit about your training so far and what you want from the next 12 weeks, and I'll build your first block.";

export const GUIDES = {
  featured: {
    id: 'g-12-week-block', title: 'Running a 12-week block without losing clients at week 6', minutes: 8,
    tags: ['Programming', 'Retention'],
    body: 'Week 6 is where motivation dips and novelty wears off. Plan a deload into week 5, re-test a key lift in week 6 so the client sees a number move, and use the weekly check-in to ask one specific question about what felt hardest. Clients who see progress and feel heard stay above 80% adherence.',
  },
  tips: [
    { id: 't-missed', title: 'Missed two sessions?', minutes: 1, tags: ['Retention'], body: 'Message within 24h with one easy win, not a reschedule link.' },
    { id: 't-overload', title: 'Progressive overload cue', minutes: 1, tags: ['Programming'], body: 'If all sets hit top reps at RPE ≤ 7, add 2.5 kg next session.' },
    { id: 't-sleep', title: 'Open with sleep', minutes: 1, tags: ['Programming'], body: 'Open each 1:1 with one question about sleep. It predicts session quality better than mood.' },
    { id: 't-pricing', title: 'Price the outcome', minutes: 2, tags: ['Business'], body: 'Sell the 12-week result, not the hour. Monthly plans with session credits smooth your income and their attendance.' },
    { id: 't-checkin', title: 'Reply to every check-in', minutes: 1, tags: ['Retention'], body: 'A two-line reply on Sunday night is the cheapest retention tool you have.' },
  ],
};

/**
 * JK's guides for clients: short reads on training, food, sleep and recovery.
 * Every plan includes 'guides' (it is the main thing Free offers). The coach
 * tips in GUIDES above are for the coach; these are written to the client.
 */
export const CLIENT_GUIDES = [
  { id: 'cg-first-weeks', title: 'Your first four weeks', summary: 'What to expect while we find your numbers, and why the first weeks feel easy.', minutes: 3, tags: ['Training'],
    body: 'The first block is about finding your numbers, not chasing them. Loads will feel light on purpose: we want every rep clean and every session logged, so the second block can be built on what you actually did.\n\nLog every set, even the bad ones. A missed rep tells me more than a perfect week.\n\nIf something hurts, as opposed to feeling hard, tell me the same day. We change the exercise, not your plan.' },
  { id: 'cg-protein', title: 'Protein without the maths', summary: 'Four meals, a palm of protein at each, and why breakfast matters most.', minutes: 2, tags: ['Food'],
    body: 'Most people eat enough protein at dinner and almost none at breakfast. Start there.\n\nAim for a palm-sized portion at each meal: eggs, Greek yoghurt, chicken, fish, tofu or a scoop of whey. Four of those and you are close to where you need to be without weighing anything.\n\nIf you only change one thing this month, make it breakfast.' },
  { id: 'cg-sleep', title: 'Sleep is training', summary: 'The one habit that makes every other one easier.', minutes: 3, tags: ['Recovery'],
    body: 'You get stronger between sessions, not during them, and most of that happens asleep.\n\nPick a lights-out time and keep it five nights a week. Keep the phone out of the bedroom. A cool, dark room helps more than any supplement.\n\nA short night happens. Two in a row and we lighten the next session; tell me in your check-in.' },
  { id: 'cg-missed', title: 'When you miss a day', summary: 'A miss lowers the count; it never wipes it out. Here is how to get back on.', minutes: 2, tags: ['Habits'],
    body: 'A day counts once you hit my minimum, not every habit. Miss one and the count dips; it does not reset.\n\nThe only rule is not to miss twice. The morning after a miss, do the easiest habit first and the rest follows.\n\nIf you are travelling or ill, message me and I will give you a rest day. Rest days are neither done nor missed.' },
  { id: 'cg-steps', title: 'Steps, not cardio', summary: 'Why walking is the quiet engine of fat loss and recovery.', minutes: 2, tags: ['Training', 'Food'],
    body: 'Walking burns more over a week than most cardio sessions, and it does not eat into your recovery.\n\nAdd a ten-minute walk after two meals a day. Take calls on your feet. Your steps fill in from your phone, so there is nothing to log.' },
  { id: 'cg-checkin', title: 'Getting the most from your check-in', summary: 'One minute on Sunday shapes your letter on Monday.', minutes: 1, tags: ['Coaching'],
    body: 'Your check-in is how I write your letter. Be honest about energy and stress; a low week is information, not a failure.\n\nThe win and the struggle matter most. One line each is plenty.' },
];
