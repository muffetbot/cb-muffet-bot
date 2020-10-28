/*
	THIS APP USES AN ADAPTATION OF FUZZYSORT NPM MODULE
	BY https://github.com/farzher FOR STANDALONE USE

MIT License

Copyright (c) 2018 Stephen Kamenar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/*
 GLOBAL CONSTANTS/SETTINGS
*/
const OWNER = cb.room_slug, // room owner name
	ME = '{{me}}',
	ME_REGEX = new RegExp(ME, 'g');

/*
 GLOBAL VARIABLES
*/
// color options
const COLORS = {
	black: '#000000',
	blue: '#0000FF',
	green: '#008000',
	orange: '#FFA500',
	red: '#FF0000',
	purple: '#800080',
	yellow: '#ffff00',
};

// GLOBAL SETTINGS OBJECT
const SETTINGS = {
	colors: {
		ok: 'green',
		err: 'red',
	},
	fuzz_check_lim: 120, // past this message length, the fuzzer will not analyze the message
	fuzz_max_range: 150, // lower is more discriminant
	fuzz_min_ratio: 0.85, // higher is more discriminant (0 to 1)
	leave_msg: '',
};

/*
	fuzzy_filters template hash:
	{
		key: '{{me}} is 79 years old!',	// message to send user if their message passes fuzz analysis - {{me}} will be replaced with model name
		value: ['how', 'old', 'are', 'you'],	// split by whitespace
	}
*/
let fuzzy_filters = new Map();

/*
 APP SETTINGS TO REQUEST ON INIT
 available at runtime as attributes in cb.settings object
 name value sets key in cb.settings object
*/
cb.settings_choices = [
	{
		name: 'ok_color',
		defaultValue: 'green',
		label: 'Color for chat notifications.',
		type: 'choice',
		choices: Reflect.ownKeys(COLORS),
	},
	{
		name: 'err_color',
		defaultValue: 'red',
		label: 'Color for user error notifications',
		type: 'choice',
		choices: Reflect.ownKeys(COLORS),
	},
	{
		name: 'leave_msg',
		defaultValue: 'FUCK OFF!!!',
		type: 'str',
		label: 'This message will display when the stream ends',
		required: false,
	},
	{
		name: 'faq0',
		type: 'str',
		label: `FAQ for the app to answer, followed by trigger words for this FAQ.
		Please separate with a double semicolon. {{me}} will be replaced with your username.
		example: {{me}} is 79 years old!;;how old are you`,
		required: false,
	},
	{
		name: 'faq1',
		type: 'str',
		label: `FAQ for the app to answer, followed by trigger words for this FAQ.`,
		required: false,
	},
	{
		name: 'faq2',
		type: 'str',
		label: `FAQ for the app to answer, followed by trigger words for this FAQ.`,
		required: false,
	},
	{
		name: 'faq3',
		type: 'str',
		label: `FAQ for the app to answer, followed by trigger words for this FAQ.`,
		required: false,
	},
	{
		name: 'faq4',
		type: 'str',
		label: `FAQ for the app to answer, followed by trigger words for this FAQ.`,
		required: false,
	},
	{
		name: 'fuzz_check_lim',
		defaultValue: 120,
		label: 'past this chat message length, the fuzzer will not analyze the message for FAQs',
		type: 'int',
		required: false,
	},
	{
		name: 'fuzz_max_range',
		defaultValue: 150,
		label: 'lower is more discriminant',
		type: 'int',
		required: false,
	},
	{
		name: 'fuzz_min_ratio',
		defaultValue: 0.85,
		label: 'higher is more discriminant (value between 0 and 1)',
		type: 'int',
		required: false,
	},
];

/*
 FUNCTION DECLARATIONS
*/
// faster as a function
const isString = str => typeof str === 'string';

// shorthands for room notices
const success = (msg, user) => cb.sendNotice(msg, user, '', SETTINGS.colors.ok); // send green notice to user only
const warn = (warning, user) => cb.sendNotice(warning, user, '', SETTINGS.colors.err); // send red notice to user only
const shout = msg => cb.sendNotice(msg, '', '', SETTINGS.colors.ok); // send green notice to room

// returns array of owner + mod names
const privileged = () => {
	let have = [OWNER];
	cb.getRoomUsersData(data => {
		if (!data.success) {
			warn('unable to get user data', OWNER);
			return;
		}

		have = have.concat(data.data.moderator);
	});
	return have;
};

// returns true if `user` has mod/owner privileges
const hasPrivileges = user => privileged().includes(user);

// sends notice to all mods/owners
const msgPrivileged = msg => privileged().forEach(p => success(msg, p));

/*
 provides getters for statistical analysis for fuzzy matching
 plot method for testing, preferrably with console.table()
*/
class Analyzer {
	constructor() {
		this.scores = [];
	}

	static avg(arr) {
		return arr.reduce((a, c) => (a += c)) / arr.length;
	}

	get match_scores() {
		return this.scores.filter(Boolean);
	}

	get match_ratio() {
		return this.scores.filter(s => s && s > -1000).length / this.scores.length;
	}

	get mean() {
		return Analyzer.avg(this.scores);
	}

	get match_mean() {
		return Analyzer.avg(this.match_scores);
	}

	get min_max() {
		const matched = this.match_scores;
		return [Math.min(...matched), Math.max(...matched)];
	}

	get range() {
		const [min, max] = this.min_max;
		return max - min;
	}

	get std_deviation() {
		const mean = this.mean;
		const variance = Analyzer.avg(this.scores.map(s => Math.pow(s - mean, 2)));
		return Math.sqrt(variance);
	}

	get match_std_deviation() {
		const mean = this.match_mean;
		const variance = Analyzer.avg(this.match_scores.map(s => Math.pow(s - mean, 2)));
		return Math.sqrt(variance);
	}

	get z_scores() {
		const mean = this.mean,
			std_dev = this.std_deviation;
		return this.scores.map(s => s - mean / std_dev);
	}

	get match_z_scores() {
		const mean = this.match_mean,
			std_dev = this.match_std_deviation;
		return this.scores.map(s => s - mean / std_dev);
	}

	plot() {
		let stats = {};
		for (const attr of [
			'scores',
			'z_scores',
			'match_z_scores',
			'match_ratio',
			'mean',
			'match_mean',
			'min_max',
			'range',
			'std_deviation',
			'match_std_deviation',
		])
			stats[attr] = this[attr];

		return stats;
	}
}

/*
 Fuzzy class much easier for instancing
 cache is static, so can be cleared after set interval
 self-purging for garbage collection
 USAGE: access data via Analyzer parent class methods after using run() method
 */
class Fuzzy extends Analyzer {
	constructor(target, ...queries) {
		super();
		this.matches_simple = [];
		this.matches_strict = [];
		this.target = target;
		this.queries = [...queries].map(q => Fuzzy.getPreparedQuery(q));
		return this;
	}

	algorithm(query_lower_codes) {
		const target_lower_codes = this.target_lower_codes,
			query_len = query_lower_codes.length,
			target_len = target_lower_codes.length;

		let query_i = 0,
			target_i = 0,
			typo_simple_i = 0,
			matches_simple_len = 0,
			query_lower_code = query_lower_codes[0];

		while (true) {
			let is_match = query_lower_code === target_lower_codes[target_i];
			if (is_match) {
				this.matches_simple[matches_simple_len++] = target_i;
				++query_i;
				if (query_i === query_len) break;
				query_lower_code =
					query_lower_codes[!typo_simple_i ? query_i : typo_simple_i === query_i ? query_i - 1 : query_i];
			}

			++target_i;
			if (target_i >= target_len) {
				while (true) {
					if (query_i <= 1) return 0;
					let query_lower_code_new;
					if (!typo_simple_i) {
						--query_i;
						query_lower_code_new = query_lower_codes[query_i];
						if (query_lower_code === query_lower_code_new) continue;
						typo_simple_i = query_i;
					} else {
						if (typo_simple_i === 1) return 0;
						--typo_simple_i;
						query_i = typo_simple_i;
						query_lower_code = query_lower_codes[query_i + 1];
						query_lower_code_new = query_lower_codes[query_i];
						if (query_lower_code === query_lower_code_new) continue;
					}

					matches_simple_len = query_i;
					target_i = this.matches_simple[matches_simple_len - 1] + 1;
					break;
				}
			}
		}

		query_i = 0;
		let typo_strict_i = 0,
			matches_strict_len = 0,
			success_strict = false;
		const next_beginning_indexes = this.next_beginning_indexes;

		const first_possible_i = this.matches_simple[0] === 0 ? 0 : next_beginning_indexes[this.matches_simple[0] - 1];
		target_i = first_possible_i;

		if (target_i !== target_len)
			while (true) {
				if (target_i >= target_len) {
					if (query_i <= 0) {
						++typo_strict_i;
						if (typo_strict_i > query_len - 2) break;
						if (query_lower_codes[typo_strict_i] === query_lower_codes[typo_strict_i + 1]) continue;
						target_i = first_possible_i;
						continue;
					}

					--query_i;
					let last_match = this.matches_strict[--matches_strict_len];
					target_i = next_beginning_indexes[last_match];
				} else {
					let is_match =
						query_lower_codes[
							!typo_strict_i
								? query_i
								: typo_strict_i === query_i
								? query_i + 1
								: typo_strict_i === query_i - 1
								? query_i - 1
								: query_i
						] === target_lower_codes[target_i];

					if (is_match) {
						this.matches_strict[matches_strict_len++] = target_i;
						++query_i;
						if (query_i === query_len) {
							success_strict = true;
							break;
						}
						++target_i;
					} else target_i = next_beginning_indexes[target_i];
				}
			}

		{
			const matches_best = success_strict ? this.matches_strict : this.matches_simple;

			let score = 0,
				last_target_i = -1;
			for (let i = 0; i < query_len; ++i) {
				target_i = matches_best[i];
				if (last_target_i !== target_i - 1) score -= target_i;
				last_target_i = target_i;
			}

			if (!success_strict) {
				score *= 1000;
				if (typo_simple_i) score -= 20;
			} else {
				if (typo_strict_i) score -= 20;
			}

			score -= target_len - query_len;
			return score;
		}
	}

	algorithmPunishTypo(query_lower_codes) {
		const target_lower_codes = this.target_lower_codes,
			query_len = query_lower_codes.length,
			target_len = target_lower_codes.length;

		let query_i = 0,
			target_i = 0,
			matches_simple_len = 0,
			query_lower_code = query_lower_codes[0];

		while (true) {
			let is_match = query_lower_code === target_lower_codes[target_i];
			if (is_match) {
				this.matches_simple[matches_simple_len++] = target_i;
				++query_i;
				if (query_i === query_len) break;
				query_lower_code = query_lower_codes[query_i];
			}

			++target_i;
			if (target_i >= target_len) return 0;
		}

		query_i = 0;
		let matches_strict_len = 0,
			success_strict = false;
		const next_beginning_indexes = this.next_beginning_indexes;

		target_i = this.matches_simple[0] === 0 ? 0 : next_beginning_indexes[this.matches_simple[0] - 1];

		if (target_i !== target_len)
			while (true) {
				if (target_i >= target_len) {
					if (query_i <= 0) break;

					--query_i;
					let last_match = this.matches_strict[--matches_strict_len];
					target_i = next_beginning_indexes[last_match];
				} else {
					let is_match = query_lower_codes[query_i] === target_lower_codes[target_i];

					if (is_match) {
						this.matches_strict[matches_strict_len++] = target_i;
						++query_i;
						if (query_i === query_len) {
							success_strict = true;
							break;
						}
						++target_i;
					} else target_i = next_beginning_indexes[target_i];
				}
			}
		{
			const matches_best = success_strict ? this.matches_strict : this.matches_simple;

			let score = 0,
				last_target_i = -1;
			for (let i = 0; i < query_len; ++i) {
				target_i = matches_best[i];
				if (last_target_i !== target_i - 1) score -= target_i;
				last_target_i = target_i;
			}

			if (!success_strict) score *= 1000;

			score -= target_len - query_len;
			return score;
		}
	}

	static qObjify(query) {
		return { q: query };
	}

	static getPreparedQuery(query) {
		if (query.length > 999) return this.prepareLowerCodes(query);
		const q_obj = this.qObjify(query);
		let query_prepared = this.prepared_query_cache.get(q_obj);
		if (query_prepared !== undefined) return query_prepared;
		query_prepared = this.prepareLowerCodes(query);
		this.prepared_query_cache.set(q_obj, query_prepared);
		return query_prepared;
	}

	set target(target) {
		this._target = target;
		this.target_len = target.length;

		this.target_lower_codes = Fuzzy.prepareLowerCodes(target);
		this.next_beginning_indexes = this.prepareNextBeginningIndexes(target);
	}

	static prepareLowerCodes(str) {
		const str_len = str.length,
			lower_codes = [],
			lower = str.toLowerCase();

		for (let i = 0; i < str_len; i++) lower_codes[i] = lower.charCodeAt(i);
		return lower_codes;
	}

	prepareBeginningIndexes() {
		const beginning_indexes = [];

		let beginning_indexes_len = 0,
			was_upper = false,
			was_alpha_num = false;

		for (let i = 0; i < this.target_len; i++) {
			let target_code = this._target.charCodeAt(i),
				is_upper = target_code >= 65 && target_code <= 90,
				is_alpha_num =
					is_upper || (target_code >= 97 && target_code <= 122) || (target_code >= 48 && target_code <= 57),
				is_beginning = (is_upper && !was_upper) || !was_alpha_num || !is_alpha_num;

			was_upper = is_upper;
			was_alpha_num = is_alpha_num;
			if (is_beginning) beginning_indexes[beginning_indexes_len++] = i;
		}
		return beginning_indexes;
	}

	prepareNextBeginningIndexes() {
		const beginning_indexes = this.prepareBeginningIndexes(),
			next_beginning_indexes = [];

		let last_is_beginning = beginning_indexes[0],
			last_is_beginning_i = 0;

		for (let i = 0; i < this.target_len; i++) {
			if (last_is_beginning > i) next_beginning_indexes[i] = last_is_beginning;
			else {
				last_is_beginning = beginning_indexes[++last_is_beginning_i];
				next_beginning_indexes[i] = last_is_beginning === undefined ? last_is_beginning : this.target_len;
			}
		}
		return next_beginning_indexes;
	}

	cleanup() {
		this.matches_simple.length = this.matches_strict.length = 0;
	}

	static clear() {
		this.prepared_query_cache.clear();
	}

	run(allow_typo = true) {
		const algorithm = allow_typo ? this.algorithm.bind(this) : this.algorithmPunishTypo.bind(this);
		for (const query of this.queries) this.scores.push(algorithm(query));
		this.cleanup();
		return this;
	}
}

// bypass cb parser error
Reflect.set(Fuzzy, 'prepared_query_cache', new WeakMap());
Object.freeze(Fuzzy);

/*
 COMMANDS OBJECT
 `fn` inner object acts as callback
 `help` will be displayed for this command in !help command
 `restricted` inner attr hides command from non mod/owner users if set to true
*/
const COMMANDS = {
	'!addfaqs ': {
		fn: obj => {
			const user = obj.user,
				faqs = obj.m.replace('!addfaqs ', '').split('::');

			let added = 0,
				failed = [];
			for (const faq of faqs) {
				let [prompt, triggers] = faq.split(';;');
				prompt = prompt.trim();

				if (!fuzzy_filters.has(prompt)) {
					fuzzy_filters.set(prompt, [
						...new Set(
							...triggers
								.toLowerCase()
								.split(' ')
								.map(t => t.trim())
						),
					]);
					++added;
					continue;
				}
				failed.push(prompt);
			}

			if (!failed.length) return `${added} FAQ's successfully added!`;

			warn(`${failed.join('; ')} already exist!`, user);
			if (added) return `${added} FAQ's added`;
		},
		help: `Add FAQ's many at a time, separated by double colons.
		example: !addfaqs {{me}} is 79 years old!;;how old are you::{{me}} doesn't do that;;open socks bb`,
		restricted: true,
	},
	'!addfaq ': {
		fn: obj => {
			const user = obj.user;
			let [prompt, triggers] = obj.m.replace('!addfaq ', '').split(';;');
			triggers = [
				...new Set(
					...triggers
						.toLowerCase()
						.split(' ')
						.map(t => t.trim())
				),
			];

			if (!fuzzy_filters.has(prompt)) {
				fuzzy_filters.set(prompt, triggers);
				return 'FAQ was added!';
			}

			warn('FAQ already exists', user);
		},
		help: `Add FAQ for the app to answer, followed by its trigger words.
		Please separate with a double semicolon. {{me}} will be replaced with your username.
		example: !addfaq {{me}} is 79 years old!;;how old are you`,
		restricted: true,
	},
	'!rmfaq ': {
		fn: obj => {
			const user = obj.user,
				faq = obj.m.replace('!rmfaq ', '').toLowerCase().replace(ME_REGEX, OWNER);

			const iter = fuzzy_filters.keys();
			let next = iter.next();
			while (!next.done) {
				let f = next.value.toLowerCase();
				if (f === faq) {
					fuzzy_filters.delete(next.value);
					return 'FAQ successfully removed!';
				} else if (f.contains(ME) && f.replace(ME_REGEX, OWNER) === faq) {
					fuzzy_filters.delete(next.value);
					return 'FAQ successfully removed!';
				}
				next = iter.next();
			}

			warn("FAQ was not found! Use !faqs command for a list of active FAQ's", user);
		},
		help: `Remove a FAQ if it exists. Use the !faqs command to see active FAQ's.
		example: !rmfaq {{me}} is 79 years old!`,
		restricted: true,
	},
	'!lemon': {
		fn: obj => {
			const fllw =
				'FOLLOW!!! SUBSCRIBE ON YOUTUBE!! FOLLOW ON TWITTER AND JOIN THE PATREON!! JOIN THE DISCORD!! STEELCUTKAWAII.COM';
			const user = obj.user.toLowerCase();
			const qualified = user === 'lemon_ways' || user === 'xx_spidder_xx';

			if (qualified) shout(fllw);
			else warn('bad boy', obj.user);
		},
		help: 'If you are not lemon and you use this command, you will be punished.',
		restricted: false,
	},
	'!help': {
		fn: obj => {
			const cmds = Reflect.ownKeys(COMMANDS).sort();
			const help = [];

			for (const cmd of cmds) {
				const c = COMMANDS[cmd];
				if (c.restricted) {
					if (hasPrivileges(obj.user)) help.push(`${cmd}: ${c.help}`);
				} else help.push(`${cmd}: ${c.help}`);
			}

			return help.join('\n');
		},
		help: 'Print this help text in chat.',
		restricted: false,
	},
	'!commands': {
		fn: obj => {
			const cmds = Reflect.ownKeys(COMMANDS).sort();

			if (hasPrivileges(obj.user)) return cmds.join(', ');
			return cmds.filter(cmd => !COMMANDS[cmd].restricted).join(', ');
		},
		help: 'List all available commands.',
		restricted: false,
	},
	'!faqs': {
		fn: _ => {
			const faqs = [];
			const iter = fuzzy_filters.keys();
			let next = iter.next();
			while (!next.done) {
				let faq = next.value.replace('{{me}}', OWNER);
				faqs.push(faq);
				next = iter.next();
			}

			return faqs.join('\n');
		},
		help: "List of all active FAQ's automatically answered by the bot.",
		restricted: false,
	},
};

Object.freeze(COMMANDS);

// fuzzy validator
function fuzzMatch(fuzzy) {
	return fuzzy.match_ratio < SETTINGS.fuzz_min_ratio || fuzzy.range > SETTINGS.fuzz_max_range;
	// TODO: refine match criteria
}

// fuzzy matcher
function fuzzIter(msg) {
	const msg_len = msg.length;
	if (!msg_len || msg_len > SETTINGS.fuzz_check_lim) return;

	const iter = fuzzy_filters.entries();
	let next = iter.next();
	while (!next.done) {
		let [key, val] = next.value,
			fuzz = new Fuzzy(msg, ...val).run();

		if (fuzzMatch(fuzz)) return key.replace(ME_REGEX, OWNER);
		next = iter.next();
	}
}

/*
 CB CALLBACK FUNCTIONS
*/
cb.onStart(_ => {
	const [ok, err] = [cb.settings.ok_color, cb.settings.err_color];
	if (ok) SETTINGS.colors.ok = ok;
	if (err) SETTINGS.colors.err = err;

	for (const attr of ['fuzz_check_lim', 'fuzz_max_range', 'fuzz_min_ratio', 'leave_msg']) {
		if (SETTINGS[attr]) SETTINGS[attr] = cb.settings[attr];
	}

	const settings = Reflect.ownKeys(cb.settings);

	for (const setting of settings) {
		if (!setting.startsWith('faq')) continue;

		const faq = cb.settings[setting];
		const [prompt, triggers] = faq.split(';;');
		fuzzy_filters.set(
			prompt,
			triggers
				.toLowerCase()
				.split(' ')
				.map(t => t.trim())
		);
	}
});

cb.onBroadcastStop(_ => {
	const bye_message = SETTINGS.leave_msg;

	if (bye_message) {
		const now = new Date();
		switch (now.getUTCHours()) {
			case 5:
				if (now.getUTCMinutes() > 50) shout(bye_message);
				break;
			case 6:
				shout(bye_message);
				break;
			default:
		}
	}
});

cb.onMessage(msg => {
	for (const cmd in COMMANDS) {
		if (msg.m.trimLeft().startsWith(cmd)) {
			const c = COMMANDS[cmd];

			if (c.restricted && !hasPrivileges(msg.user)) break;

			const res = c.fn(msg);
			if (isString(res)) success(res, msg.user);
			msg.m = '';
			break;
		}
	}

	const fuzzed_faq = fuzzIter(msg.m);
	if (isString(fuzzed_faq)) return success(fuzzed_faq, msg.user);
	return msg;
});
