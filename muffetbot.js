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
const CHECK_LIM = 100, // number of filters to check for duplicates on insertion, lower is faster
	MAX_FILTER_LEN = 150, // upper bound for acceptable filter string length, lower is faster
	MAX_WHITE_SPACE = 7, // limit for allowed number of whitespace in filters, lower is faster
	OWNER = cb.room_slug, // room owner name
	[GREEN, RED] = ['#008000', '#FF0000'];

/*
 GLOBAL VARIABLES
*/
let filter_privileged = false, // variable set to cb.settings.filter_privileged on app start
	word_filters = [], // terms to hide from chat
	/*
	fuzzy_filters template object:
	{

	}
*/
	fuzzy_filters = []; // possible triggers for fuzzyfinding FAQ's

/*
 APP SETTINGS TO REQUEST ON INIT
 available at runtime as attributes in cb.settings object
*/
cb.settings_choices = [
	{
		name: 'leave_msg',
		default: 'FUCK OFF!!!',
		type: 'str',
		label: 'This message will display when the stream ends',
		required: false,
	},
	{
		name: 'filter_privileged',
		type: 'str',
		label: 'Write `yes` or `true` if app should also silence filters from mods/owner',
		required: false,
	},
	{
		name: 'filters', // name value sets key in cb.settings object
		type: 'str',
		label: 'Terms for the app to silence, separated by commas',
		required: false,
	},
];

/*
 FUNCTION DECLARATIONS
*/

// faster as a function
const isObj = x => typeof x === 'object';

// returns true if `str` incidences of whitespace exceed MAX_WHITE_SPACE
const max_whitespace_exceeded = str => {
	for (let i = (count = 0); i < str.length; count += +(' ' === str[i++])) {
		if (count > MAX_WHITE_SPACE) return true;
	}
	return false;
};

// shorthands for room notices
const success = (msg, user) => cb.sendNotice(msg, user, '', GREEN); // send green notice to user only
const warn = (warning, user) => cb.sendNotice(warning, user, '', RED); // send red notice to user only
const shout = msg => cb.sendNotice(msg, '', '', GREEN); // send green notice to room

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

// optimized for adding a single filter
const addFilter = term => {
	term = term.trim();

	if (term.length > MAX_FILTER_LEN || max_whitespace_exceeded(term)) {
		return;
	}

	if (word_filters.length < CHECK_LIM && word_filters.includes(term)) return false;

	word_filters.push(term);
	word_filters = [...new Set(word_filters)];
	return true;
};

/*
	optimized for adding filters as a batch

	template `addObj` object:
	{
		to_add: [...array of filters to attempt add],
		added: [],
		lorge: [],
		redundant: [],
	}

	modeled to work like a generator function. i.e. :
	let done = deferredAdd(obj);
	while(!done) done = deferredAdd(obj);
*/
const deferredAdd = addObj => {
	if (!addObj.to_add.length) {
		word_filters = [...new Set(word_filters.concat(addObj.added))];
		return true;
	}
	const next = addObj.to_add.pop().trim();

	if (next.length > MAX_FILTER_LEN || max_whitespace_exceeded(next)) {
		addObj.lorge.push(next);
	} else if (word_filters.length < CHECK_LIM && word_filters.includes(next)) {
		addObj.redundant.push(next);
	} else {
		addObj.added.push(next);
	}
	return false;
};

// optimized for removing a single filter
const rmFilter = term => {
	term = term.trim();
	if (word_filters.includes(term)) {
		word_filters = word_filters.filter(w => w !== term);
		return true;
	}
	return false;
};

/*
	optimized for removing filters as a batch

	template `rmObj` object:
	{
		to_remove: [...array of filters to attempt removal],
		removed: [],
		not_found: [],
	}

	modeled to work like a generator function. i.e. :
	let done = deferredRm(obj);
	while(!done) done = deferredRm(obj);
*/
const deferredRm = rmObj => {
	if (!rmObj.to_remove.length) {
		word_filters = word_filters.filter(w => !rmObj.removed.includes(w));
		return true;
	}
	const next = rmObj.to_remove.pop().trim();
	if (word_filters.includes(next)) {
		rmObj.removed.push(next);
	} else {
		rmObj.not_found.push(next);
	}
	return false;
};

// censor filter
// obeys cb.setting.filter_privileged
const filterMsg = msg => {
	if (!filter_privileged && hasPrivileges(msg.user)) return;

	const msgText = msg.m.toLowerCase();
	for (const f of word_filters) {
		if (msgText.includes(f)) {
			msg['X-Spam'] = true;

			warn('your message contains a filtered word and was hidden from chat', msg.user);
			break;
		}
	}
};

/*
 provides getters for statistical analysis for fuzzy matching
 plot method for testing, preferrably with console.table()
*/
class Analyzer {
	scores = [];

	static avg(arr) {
		return arr.reduce((a, c) => (a += c)) / arr.length;
	}

	get match_scores() {
		return this.scores.filter(Boolean);
	}

	get match_ratio() {
		return this.match_scores.length / this.scores.length;
	}

	get mean() {
		return Analyzer.avg(this.scores);
	}

	get match_mean() {
		return Analyzer.avg(this.match_scores);
	}

	get min_max() {
		const pos = this.match_scores;
		return [Math.min(...pos), Math.max(...pos)];
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
		]) {
			stats[attr] = this[attr];
		}

		return stats;
	}
}

/*
 Fuzzy class much easier for instancing
 cache is static, so can be cleared after set interval
 self-purging for garbage collection
 USAGE: access data via Analyzer parent class methods after using run() method
 
 TODO: maybe use WeakMap instead of Map for cache
*/
class Fuzzy extends Analyzer {
	static prepared_query_cache = new Map();
	matches_simple = [];
	matches_strict = [];

	constructor(target, ...queries) {
		super();
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
			matches_simple_len = 0;
		let query_lower_code = query_lower_codes[0];

		while (true) {
			let is_match = query_lower_code === target_lower_codes[target_i];
			if (is_match) {
				this.matches_simple[matches_simple_len++] = target_i;
				++query_i;
				if (query_i === query_len) break;
				query_lower_code =
					query_lower_codes[
						!typo_simple_i ? query_i : typo_simple_i === query_i ? query_i - 1 : query_i
					];
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

		const first_possible_i =
			this.matches_simple[0] === 0 ? 0 : next_beginning_indexes[this.matches_simple[0] - 1];
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
					} else {
						target_i = next_beginning_indexes[target_i];
					}
				}
				// if (target_i === undefined) break;
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

		target_i =
			this.matches_simple[0] === 0 ? 0 : next_beginning_indexes[this.matches_simple[0] - 1];

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
					} else {
						target_i = next_beginning_indexes[target_i];
					}
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

	static getPreparedQuery(query) {
		if (query.length > 999) return this.prepareLowerCodes(query);
		let query_prepared = this.prepared_query_cache.get(query);
		if (query_prepared !== undefined) return query_prepared;
		query_prepared = this.prepareLowerCodes(query);
		this.prepared_query_cache.set(query, query_prepared);
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
		for (let i = 0; i < str_len; i++) {
			lower_codes[i] = lower.charCodeAt(i);
		}
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
					is_upper ||
					(target_code >= 97 && target_code <= 122) ||
					(target_code >= 48 && target_code <= 57),
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
			if (last_is_beginning > i) {
				next_beginning_indexes[i] = last_is_beginning;
			} else {
				last_is_beginning = beginning_indexes[++last_is_beginning_i];
				next_beginning_indexes[i] = last_is_beginning ?? this.target_len;
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
		for (const query of this.queries) {
			const score = allow_typo ? this.algorithm(query) : this.algorithmPunishTypo(query);
			this.scores.push(score);
		}
		this.cleanup();
		return this;
	}
}

/*
 COMMANDS OBJECT
 `fn` inner object acts as callback
 `restricted` inner attr hides command from non mod/owner users if set to true
*/
const COMMANDS = {
	'!filters': {
		fn: _ => word_filters.join(', '),
		restricted: false,
	},
	'!addfilters': {
		fn: obj => {
			const [cmds, user] = [obj.m.replace('!addfilters', '').toLowerCase(), obj.user];

			const res = {
				to_add: cmds.split(','),
				added: [],
				lorge: [],
				redundant: [],
			};
			let done = deferredAdd(res);
			while (!done) done = deferredAdd(res);

			if (res.added.length) msgPrivileged(`${res.added.join(', ')} added to the filter list`);

			if (res.lorge.length)
				warn(
					`${res.lorge.join(', ')} were too long to add, try splitting into smaller phrases`,
					user
				);

			if (res.redundant.length)
				warn(`${res.redundant.join(', ')} are already in the filter list`, user);
		},
		restricted: true,
	},
	'!addfilter': {
		fn: obj => {
			const [cmd, user] = [obj.m.trim().toLowerCase(), obj.user];
			const term = cmd.replace('!addfilter', '');

			switch (addFilter(term)) {
				case true:
					msgPrivileged(`${term} was added to the filter list`);
					break;
				case undefined:
					warn("it's not recommended to add long phrases, try splitting them up", user);
					break;
				default:
					warn(`${term} was not added because it already exists`, user);
			}
		},
		restricted: true,
	},
	'!lemon': {
		fn: _ => {
			const fllw =
				'FOLLOW!!! SUBSCRIBE ON YOUTUBE!! FOLLOW ON TWITTER AND JOIN THE PATERON!! JOIN THE DISCORD!! STEELCUTKAWAII.COM';
			shout(fllw);
		},
		restricted: false,
	},
	'!rmfilters': {
		fn: obj => {
			const [cmds, user] = [obj.m.replace('!rmfilters', '').toLowerCase(), obj.user];

			const res = {
				to_remove: cmds.split(','),
				removed: [],
				not_found: [],
			};

			let done = deferredRm(res);
			while (!done) done = deferredRm(res);

			if (res.removed.length)
				msgPrivileged(`${res.removed.join(', ')} removed from the filter list`);

			if (res.not_found.length)
				warn(`${res.not_found.join(', ')} were not found in the filter list`, user);
		},
		restricted: true,
	},
	'!rmfilter': {
		fn: obj => {
			const [cmd, user] = [obj.m.trim().toLowerCase(), obj.user];
			const term = cmd.replace('!rmfilter', '');

			if (rmFilter(term)) {
				msgPrivileged(`${term} was removed from the filter list`);
			} else {
				warn(`${term} was not found in the filter list`, user);
			}
		},
		restricted: true,
	},
	'!commands': {
		fn: obj => {
			const cmds = Reflect.ownKeys(COMMANDS);
			if (hasPrivileges(obj.user)) {
				return cmds.join(', ');
			}

			return cmds.filter(cmd => !COMMANDS[cmd].restricted).join(', ');
		},
		restricted: false,
	},
};

// freeze COMMANDS for ensured sec at runtime
Object.freeze(COMMANDS);

/*
 CB CALLBACK FUNCTIONS
*/
cb.onStart(_ => {
	const p_setting = cb.settings.filter_privileged.toLowerCase().trim();
	filter_privileged = p_setting === 'yes' || p_setting === 'true';

	const filter_settings = cb.settings.filters;
	word_filters = [
		...new Set(
			filter_settings
				.toLowerCase()
				.split(',')
				.map(f => f.trim())
		),
	];
});

cb.onBroadcastStop(_ => {
	const bye_message = cb.settings.leave_msg;

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
			if (typeof res === 'string') success(res, msg.user);
			msg.m = '';
			break;
		}
	}

	filterMsg(msg);
	return msg;
});
