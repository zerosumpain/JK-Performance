/**
 * The iCalendar parser, time zones, bank holidays and the SSRF guard of the
 * calsync feature (docs/design/desk-v2.md F20). Pure functions: no server.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bankHolidays, durationMs, easter, isPrivateAddress, parseIcs, safeLookup, unfold, vetUrl } from '../features/calsync.mjs';

const WINDOW = { fromMs: Date.UTC(2026, 0, 1), toMs: Date.UTC(2028, 0, 1) };
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
const starts = r => r.blocks.map(b => b.start);

describe('parseIcs', () => {
  test('a TZID event, a UTC event and a floating (London) event', () => {
    const r = parseIcs(cal(
      ev('UID:a', 'SUMMARY:Dentist', 'DTSTART;TZID=Europe/London:20260714T100000', 'DTEND;TZID=Europe/London:20260714T110000'),
      ev('UID:b', 'SUMMARY:Call', 'DTSTART:20260714T130000Z', 'DTEND:20260714T133000Z'),
      ev('UID:c', 'SUMMARY:Floating', 'DTSTART:20260114T090000', 'DURATION:PT45M'),
    ), WINDOW);
    assert.deepEqual(r.blocks.map(b => [b.title, b.start, b.end]), [
      ['Floating', '2026-01-14T09:00:00.000Z', '2026-01-14T09:45:00.000Z'],
      ['Dentist', '2026-07-14T09:00:00.000Z', '2026-07-14T10:00:00.000Z'],
      ['Call', '2026-07-14T13:00:00.000Z', '2026-07-14T13:30:00.000Z'],
    ]);
    assert.deepEqual(r.warnings, []);
  });

  test('all-day events are London days, the end day exclusive', () => {
    const r = parseIcs(cal(ev('UID:d', 'SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20260803', 'DTEND;VALUE=DATE:20260805'),
      ev('UID:e', 'SUMMARY:One day', 'DTSTART;VALUE=DATE:20261225')), WINDOW);
    const h = r.blocks.find(b => b.title === 'Holiday');
    assert.equal(h.allDay, true);
    assert.equal(h.start, '2026-08-02T23:00:00.000Z'); // BST midnight
    assert.equal(h.end, '2026-08-04T23:00:00.000Z');
    const one = r.blocks.find(b => b.title === 'One day');
    assert.equal(one.start, '2026-12-25T00:00:00.000Z');
    assert.equal(one.end, '2026-12-26T00:00:00.000Z');
  });

  test('a weekly RRULE with COUNT and EXDATE, and one with UNTIL and BYDAY', () => {
    const r = parseIcs(cal(
      ev('UID:w1', 'SUMMARY:Gym', 'DTSTART;TZID=Europe/London:20260105T180000', 'DTEND;TZID=Europe/London:20260105T190000',
        'RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE;TZID=Europe/London:20260112T180000'),
      ev('UID:w2', 'SUMMARY:School run', 'DTSTART;TZID=Europe/London:20260202T150000', 'DTEND;TZID=Europe/London:20260202T154000',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260211T235959Z'),
    ), WINDOW);
    assert.deepEqual(starts({ blocks: r.blocks.filter(b => b.title === 'Gym') }), ['2026-01-05T18:00:00.000Z', '2026-01-19T18:00:00.000Z', '2026-01-26T18:00:00.000Z']);
    assert.deepEqual(r.blocks.filter(b => b.title === 'School run').map(b => b.start.slice(0, 10)), ['2026-02-02', '2026-02-04', '2026-02-06', '2026-02-09', '2026-02-11']);
  });

  test('a RECURRENCE-ID override moves one occurrence; cancelled and free events are skipped', () => {
    const r = parseIcs(cal(
      ev('UID:x', 'SUMMARY:Team', 'DTSTART:20260302T090000Z', 'DTEND:20260302T100000Z', 'RRULE:FREQ=DAILY;COUNT=3'),
      ev('UID:x', 'SUMMARY:Team (moved)', 'RECURRENCE-ID:20260303T090000Z', 'DTSTART:20260303T140000Z', 'DTEND:20260303T150000Z'),
      ev('UID:y', 'SUMMARY:Cancelled', 'STATUS:CANCELLED', 'DTSTART:20260305T090000Z', 'DTEND:20260305T100000Z'),
      ev('UID:z', 'SUMMARY:Free', 'TRANSP:TRANSPARENT', 'DTSTART:20260306T090000Z', 'DTEND:20260306T100000Z'),
    ), WINDOW);
    assert.deepEqual(r.blocks.map(b => [b.title, b.start]), [
      ['Team', '2026-03-02T09:00:00.000Z'], ['Team (moved)', '2026-03-03T14:00:00.000Z'], ['Team', '2026-03-04T09:00:00.000Z'],
    ]);
  });

  test('folded long lines and escaped text', () => {
    const r = parseIcs(cal(ev('UID:f', 'SUMMARY:Lunch with the accountant\\, then the bank', ' and the post office', 'DTSTART:20260410T120000Z', 'DTEND:20260410T130000Z')), WINDOW);
    assert.equal(r.blocks[0].title, 'Lunch with the accountant, then the bankand the post office');
    assert.deepEqual(unfold('A\r\n B\r\n\tC\r\nD'), ['ABC', 'D']);
  });

  test('a weekly 07:00 London event keeps its wall clock across both DST changes', () => {
    const r = parseIcs(cal(ev('UID:dst', 'SUMMARY:Run', 'DTSTART;TZID=Europe/London:20260322T070000', 'DTEND;TZID=Europe/London:20260322T080000',
      'RRULE:FREQ=WEEKLY;UNTIL=20261102T000000Z')), WINDOW);
    const s = starts(r);
    assert.ok(s.includes('2026-03-22T07:00:00.000Z'), 'GMT before the March change');
    assert.ok(s.includes('2026-03-29T06:00:00.000Z'), 'BST after it');
    assert.ok(s.includes('2026-10-18T06:00:00.000Z'));
    assert.ok(s.includes('2026-10-25T07:00:00.000Z'), 'GMT again after the October change');
  });

  test('Windows zone names: GMT Standard Time and W. Europe Standard Time across both changes', () => {
    const r = parseIcs(cal(
      ev('UID:g1', 'SUMMARY:L', 'DTSTART;TZID=GMT Standard Time:20260325T090000', 'DTEND;TZID=GMT Standard Time:20260325T100000', 'RRULE:FREQ=WEEKLY;COUNT=2'),
      ev('UID:g2', 'SUMMARY:L', 'DTSTART;TZID="GMT Standard Time":20261021T090000', 'DTEND;TZID="GMT Standard Time":20261021T100000', 'RRULE:FREQ=WEEKLY;COUNT=2'),
      ev('UID:b1', 'SUMMARY:B', 'DTSTART;TZID=W. Europe Standard Time:20260325T090000', 'DTEND;TZID=W. Europe Standard Time:20260325T100000', 'RRULE:FREQ=WEEKLY;COUNT=2'),
      ev('UID:b2', 'SUMMARY:B', 'DTSTART;TZID=W. Europe Standard Time:20261021T090000', 'DTEND;TZID=W. Europe Standard Time:20261021T100000', 'RRULE:FREQ=WEEKLY;COUNT=2'),
    ), WINDOW);
    const of = t => r.blocks.filter(b => b.title === t).map(b => b.start);
    assert.deepEqual(of('L'), ['2026-03-25T09:00:00.000Z', '2026-04-01T08:00:00.000Z', '2026-10-21T08:00:00.000Z', '2026-10-28T09:00:00.000Z']);
    assert.deepEqual(of('B'), ['2026-03-25T08:00:00.000Z', '2026-04-01T07:00:00.000Z', '2026-10-21T07:00:00.000Z', '2026-10-28T08:00:00.000Z']);
    assert.deepEqual(r.warnings, []);
  });

  test('an unknown TZID uses the feed’s VTIMEZONE offsets', () => {
    const vtz = ['BEGIN:VTIMEZONE', 'TZID:Custom Island Time',
      'BEGIN:STANDARD', 'DTSTART:16011028T030000', 'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0200', 'END:STANDARD',
      'BEGIN:DAYLIGHT', 'DTSTART:16010325T020000', 'RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0300', 'END:DAYLIGHT',
      'END:VTIMEZONE'];
    const r = parseIcs(cal(vtz,
      ev('UID:v1', 'SUMMARY:Winter', 'DTSTART;TZID=Custom Island Time:20260115T120000', 'DTEND;TZID=Custom Island Time:20260115T130000'),
      ev('UID:v2', 'SUMMARY:Summer', 'DTSTART;TZID=Custom Island Time:20260715T120000', 'DTEND;TZID=Custom Island Time:20260715T130000')), WINDOW);
    assert.equal(r.blocks.find(b => b.title === 'Winter').start, '2026-01-15T10:00:00.000Z');
    assert.equal(r.blocks.find(b => b.title === 'Summer').start, '2026-07-15T09:00:00.000Z');
    assert.deepEqual(r.warnings, []);
    const bad = parseIcs(cal(ev('UID:u', 'SUMMARY:?', 'DTSTART;TZID=Nowhere/Special:20260115T120000', 'DTEND;TZID=Nowhere/Special:20260115T130000')), WINDOW);
    assert.equal(bad.blocks[0].start, '2026-01-15T12:00:00.000Z');
    assert.match(bad.warnings[0], /Unknown time zone/);
  });

  test('monthly and yearly rules, DURATION, the window, and simplified rules warn', () => {
    const r = parseIcs(cal(
      ev('UID:m', 'SUMMARY:Rent', 'DTSTART:20260131T090000Z', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3'),
      ev('UID:y', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20200605', 'RRULE:FREQ=YEARLY'),
      ev('UID:p', 'SUMMARY:Odd', 'DTSTART:20260105T090000Z', 'DTEND:20260105T100000Z', 'RRULE:FREQ=MONTHLY;BYDAY=1MO;COUNT=2'),
    ), WINDOW);
    assert.deepEqual(r.blocks.filter(b => b.title === 'Rent').map(b => b.start.slice(0, 10)), ['2026-01-31', '2026-03-31', '2026-05-31']);
    assert.deepEqual(r.blocks.filter(b => b.title === 'Birthday').map(b => b.start.slice(0, 10)), ['2026-06-04', '2027-06-04']);
    assert.ok(r.warnings.includes('Some repeating events were simplified'));
    assert.equal(durationMs('P1DT2H30M'), (26 * 60 + 30) * 60_000);
    assert.equal(durationMs('-PT15M'), -15 * 60_000);
    assert.equal(durationMs('P2W'), 14 * 86_400_000);
  });

  test('at most 5000 blocks', () => {
    const r = parseIcs(cal(ev('UID:many', 'SUMMARY:Tick', 'DTSTART:20260101T000000Z', 'DTEND:20260101T000500Z', 'RRULE:FREQ=DAILY')), { ...WINDOW, max: 50 });
    assert.equal(r.blocks.length, 50);
  });
});

describe('bank holidays (England and Wales)', () => {
  test('Easter by the computus', () => {
    assert.equal(easter(2026), '2026-04-05');
    assert.equal(easter(2027), '2027-03-28');
    assert.equal(easter(2024), '2024-03-31');
  });
  test('2026 and 2027, with substitute days', () => {
    assert.deepEqual(bankHolidays(2026).map(h => h.day), ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28']);
    assert.deepEqual(bankHolidays(2027).map(h => h.day), ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28']);
    assert.equal(bankHolidays(2027).at(-1).name, 'Boxing Day (substitute day)');
  });
});

describe('the SSRF guard', () => {
  test('private and special addresses', () => {
    for (const a of ['127.0.0.1', '10.0.0.1', '100.83.68.108', '172.16.5.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1']) {
      assert.equal(isPrivateAddress(a), true, a);
    }
    for (const a of ['142.250.180.14', '8.8.8.8', '2a00:1450:4009:81f::200e', '100.128.0.1', '172.32.0.1']) assert.equal(isPrivateAddress(a), false, a);
  });

  test('vetUrl: https on 443 only, webcal rewritten, private literals and credentials refused', () => {
    assert.equal(vetUrl('webcal://p01-calendars.icloud.com/published/2/abc').href, 'https://p01-calendars.icloud.com/published/2/abc');
    for (const bad of ['https://127.0.0.1/x.ics', 'https://10.0.0.1/x.ics', 'https://100.83.68.108/x.ics', 'http://calendar.example.com/x.ics', 'https://calendar.example.com:8443/x.ics',
      'https://user:pw@calendar.example.com/x.ics', 'https://localhost/x.ics', 'https://[::1]/x.ics', 'ftp://calendar.example.com/x', 'not a url']) {
      assert.throws(() => vetUrl(bad), e => e.status === 400, bad);
    }
  });

  test('the lookup answers both call shapes and refuses when any address is private', async () => {
    const fake = map => (host, opts, cb) => { assert.equal(opts.all, true); cb(null, map[host]); };
    const lookup = safeLookup(fake({
      'cal.example.com': [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }],
      'sneaky.example.com': [{ address: '93.184.216.34', family: 4 }, { address: '10.1.2.3', family: 4 }],
      'tailnet.example.com': [{ address: '100.83.68.108', family: 4 }],
    }));
    const call = (host, opts) => new Promise(resolve => lookup(host, opts, (err, a, f) => resolve({ err, a, f })));
    const all = await call('cal.example.com', { all: true });
    assert.equal(all.err, null);
    assert.deepEqual(all.a, [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }]);
    const single = await call('cal.example.com', {});
    assert.equal(single.a, '93.184.216.34');
    assert.equal(single.f, 4);
    const legacy = await call('cal.example.com', 4);
    assert.equal(legacy.a, '93.184.216.34');
    for (const host of ['sneaky.example.com', 'tailnet.example.com']) {
      assert.equal((await call(host, { all: true })).err.code, 'EPRIVATE', host);
      assert.equal((await call(host, {})).err.code, 'EPRIVATE', host);
    }
  });
});
