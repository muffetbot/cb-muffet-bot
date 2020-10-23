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

let preparedCache = new Map(),
	preparedSearchCache = new Map(),
	matchesSimple = [],
	matchesStrict = [];

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
const shout = msg => cb.sendNotice(msg, '', GREEN); // send green notice to room

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
 FUZZYSORT OBJECT
 TODO: turn into a Class
 WARNINGS:
	 `var` keyword abused to escape scope/overwrite same idents
	 `this` object will vary wildly with current code, will need refactoring, potentially binding?
*/
const FUZZY = {
	single: (search, target, options) => {
		if (!search) return null;
		if (!isObj(search)) search = fuzzy.getPreparedSearch(search);

		if (!target) return null;
		if (!isObj(target)) target = fuzzy.getPrepared(target);

		var allowTypo = options && options.allowTypo !== undefined ? options.allowTypo : true;
		var algorithm = allowTypo ? fuzzy.algorithm : fuzzy.algorithmNoTypo;
		return algorithm(search, target, search[0]);
	},
	prepare: target => {
		if (!target) return;
		return {
			target: target,
			_targetLowerCodes: fuzzy.prepareLowerCodes(target),
			_nextBeginningIndexes: null,
			score: null,
			indexes: null,
			obj: null,
		};
	},
	prepareSearch: search => {
		if (!search) return;
		return fuzzy.prepareLowerCodes(search);
	},
	getPrepared: target => {
		if (target.length > 999) return fuzzy.prepare(target);
		var targetPrepared = preparedCache.get(target);
		if (targetPrepared !== undefined) return targetPrepared;
		targetPrepared = fuzzy.prepare(target);
		preparedCache.set(target, targetPrepared);
		return targetPrepared;
	},
	getPreparedSearch: search => {
		if (search.length > 999) return fuzzy.prepareSearch(search);
		var searchPrepared = preparedSearchCache.get(search);
		if (searchPrepared !== undefined) return searchPrepared;
		searchPrepared = fuzzy.prepareSearch(search);
		preparedSearchCache.set(search, searchPrepared);
		return searchPrepared;
	},
	algorithm: (searchLowerCodes, prepared, searchLowerCode) => {
		var targetLowerCodes = prepared._targetLowerCodes;
		var searchLen = searchLowerCodes.length;
		var targetLen = targetLowerCodes.length;
		var searchI = 0;
		var targetI = 0;
		var typoSimpleI = 0;
		var matchesSimpleLen = 0;

		for (;;) {
			var isMatch = searchLowerCode === targetLowerCodes[targetI];
			if (isMatch) {
				matchesSimple[matchesSimpleLen++] = targetI;
				++searchI;
				if (searchI === searchLen) break;
				searchLowerCode =
					searchLowerCodes[
						typoSimpleI === 0
							? searchI
							: typoSimpleI === searchI
							? searchI + 1
							: typoSimpleI === searchI - 1
							? searchI - 1
							: searchI
					];
			}

			++targetI;
			if (targetI >= targetLen) {
				for (;;) {
					if (searchI <= 1) return null;
					if (typoSimpleI === 0) {
						--searchI;
						var searchLowerCodeNew = searchLowerCodes[searchI];
						if (searchLowerCode === searchLowerCodeNew) continue;
						typoSimpleI = searchI;
					} else {
						if (typoSimpleI === 1) return null;
						--typoSimpleI;
						searchI = typoSimpleI;
						searchLowerCode = searchLowerCodes[searchI + 1];
						var searchLowerCodeNew = searchLowerCodes[searchI];
						if (searchLowerCode === searchLowerCodeNew) continue;
					}
					matchesSimpleLen = searchI;
					targetI = matchesSimple[matchesSimpleLen - 1] + 1;
					break;
				}
			}
		}

		var searchI = 0;
		var typoStrictI = 0;
		var successStrict = false;
		var matchesStrictLen = 0;

		var nextBeginningIndexes = prepared._nextBeginningIndexes;
		if (nextBeginningIndexes === null)
			nextBeginningIndexes = prepared._nextBeginningIndexes = fuzzy.prepareNextBeginningIndexes(
				prepared.target
			);
		var firstPossibleI = (targetI =
			matchesSimple[0] === 0 ? 0 : nextBeginningIndexes[matchesSimple[0] - 1]);

		if (targetI !== targetLen)
			for (;;) {
				if (targetI >= targetLen) {
					if (searchI <= 0) {
						++typoStrictI;
						if (typoStrictI > searchLen - 2) break;
						if (searchLowerCodes[typoStrictI] === searchLowerCodes[typoStrictI + 1])
							continue;
						targetI = firstPossibleI;
						continue;
					}

					--searchI;
					var lastMatch = matchesStrict[--matchesStrictLen];
					targetI = nextBeginningIndexes[lastMatch];
				} else {
					var isMatch =
						searchLowerCodes[
							typoStrictI === 0
								? searchI
								: typoStrictI === searchI
								? searchI + 1
								: typoStrictI === searchI - 1
								? searchI - 1
								: searchI
						] === targetLowerCodes[targetI];
					if (isMatch) {
						matchesStrict[matchesStrictLen++] = targetI;
						++searchI;
						if (searchI === searchLen) {
							successStrict = true;
							break;
						}
						++targetI;
					} else {
						targetI = nextBeginningIndexes[targetI];
					}
				}
			}

		{
			if (successStrict) {
				var matchesBest = matchesStrict;
				var matchesBestLen = matchesStrictLen;
			} else {
				var matchesBest = matchesSimple;
				var matchesBestLen = matchesSimpleLen;
			}
			var score = 0;
			var lastTargetI = -1;
			for (var i = 0; i < searchLen; ++i) {
				var targetI = matchesBest[i];
				if (lastTargetI !== targetI - 1) score -= targetI;
				lastTargetI = targetI;
			}
			if (!successStrict) {
				score *= 1000;
				if (typoSimpleI !== 0) score += -20;
			} else {
				if (typoStrictI !== 0) score += -20;
			}
			score -= targetLen - searchLen;
			prepared.score = score;
			prepared.indexes = new Array(matchesBestLen);
			for (var i = matchesBestLen - 1; i >= 0; --i) prepared.indexes[i] = matchesBest[i];

			return prepared;
		}
	},
	algorithmNoTypo: (searchLowerCodes, prepared, searchLowerCode) => {
		var targetLowerCodes = prepared._targetLowerCodes;
		var searchLen = searchLowerCodes.length;
		var targetLen = targetLowerCodes.length;
		var searchI = 0;
		var targetI = 0;
		var matchesSimpleLen = 0;

		for (;;) {
			var isMatch = searchLowerCode === targetLowerCodes[targetI];
			if (isMatch) {
				matchesSimple[matchesSimpleLen++] = targetI;
				++searchI;
				if (searchI === searchLen) break;
				searchLowerCode = searchLowerCodes[searchI];
			}
			++targetI;
			if (targetI >= targetLen) return null;
		}

		var searchI = 0;
		var successStrict = false;
		var matchesStrictLen = 0;

		var nextBeginningIndexes = prepared._nextBeginningIndexes;
		if (nextBeginningIndexes === null)
			nextBeginningIndexes = prepared._nextBeginningIndexes = fuzzy.prepareNextBeginningIndexes(
				prepared.target
			);
		var firstPossibleI = (targetI =
			matchesSimple[0] === 0 ? 0 : nextBeginningIndexes[matchesSimple[0] - 1]);

		if (targetI !== targetLen)
			for (;;) {
				if (targetI >= targetLen) {
					if (searchI <= 0) break;

					--searchI;
					var lastMatch = matchesStrict[--matchesStrictLen];
					targetI = nextBeginningIndexes[lastMatch];
				} else {
					var isMatch = searchLowerCodes[searchI] === targetLowerCodes[targetI];
					if (isMatch) {
						matchesStrict[matchesStrictLen++] = targetI;
						++searchI;
						if (searchI === searchLen) {
							successStrict = true;
							break;
						}
						++targetI;
					} else {
						targetI = nextBeginningIndexes[targetI];
					}
				}
			}

		{
			if (successStrict) {
				var matchesBest = matchesStrict;
				var matchesBestLen = matchesStrictLen;
			} else {
				var matchesBest = matchesSimple;
				var matchesBestLen = matchesSimpleLen;
			}
			var score = 0;
			var lastTargetI = -1;
			for (var i = 0; i < searchLen; ++i) {
				var targetI = matchesBest[i];
				if (lastTargetI !== targetI - 1) score -= targetI;
				lastTargetI = targetI;
			}
			if (!successStrict) score *= 1000;
			score -= targetLen - searchLen;
			prepared.score = score;
			prepared.indexes = new Array(matchesBestLen);
			for (var i = matchesBestLen - 1; i >= 0; --i) prepared.indexes[i] = matchesBest[i];

			return prepared;
		}
	},
	prepareLowerCodes: str => {
		var strLen = str.length;
		var lowerCodes = [];
		var lower = str.toLowerCase();
		for (var i = 0; i < strLen; ++i) lowerCodes[i] = lower.charCodeAt(i);
		return lowerCodes;
	},
	prepareBeginningIndexes: target => {
		var targetLen = target.length;
		var beginningIndexes = [];
		var beginningIndexesLen = 0;
		var wasUpper = false;
		var wasAlphanum = false;
		for (var i = 0; i < targetLen; ++i) {
			var targetCode = target.charCodeAt(i);
			var isUpper = targetCode >= 65 && targetCode <= 90;
			var isAlphanum =
				isUpper ||
				(targetCode >= 97 && targetCode <= 122) ||
				(targetCode >= 48 && targetCode <= 57);
			var isBeginning = (isUpper && !wasUpper) || !wasAlphanum || !isAlphanum;
			wasUpper = isUpper;
			wasAlphanum = isAlphanum;
			if (isBeginning) beginningIndexes[beginningIndexesLen++] = i;
		}
		return beginningIndexes;
	},
	prepareNextBeginningIndexes: target => {
		var targetLen = target.length;
		var beginningIndexes = fuzzy.prepareBeginningIndexes(target);
		var nextBeginningIndexes = [];
		var lastIsBeginning = beginningIndexes[0];
		var lastIsBeginningI = 0;
		for (var i = 0; i < targetLen; ++i) {
			if (lastIsBeginning > i) {
				nextBeginningIndexes[i] = lastIsBeginning;
			} else {
				lastIsBeginning = beginningIndexes[++lastIsBeginningI];
				nextBeginningIndexes[i] =
					lastIsBeginning === undefined ? targetLen : lastIsBeginning;
			}
		}
		return nextBeginningIndexes;
	},
	cleanup: () => {
		preparedCache.clear();
		preparedSearchCache.clear();
		matchesSimple = [];
		matchesStrict = [];
	},
};

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
			let [cmds, user] = [obj.m.replace('!addfilters', '').toLowerCase(), obj.user];

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
					`${res.lorge.join(
						', '
					)} were too long to add, try splitting into smaller phrases`,
					user
				);

			if (res.redundant.length)
				warn(`${res.redundant.join(', ')} are already in the filter list`, user);
		},
		restricted: true,
	},
	'!addfilter': {
		fn: obj => {
			let [cmd, user] = [obj.m.trim().toLowerCase(), obj.user];
			let term = cmd.replace('!addfilter', '');

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
			let [cmds, user] = [obj.m.replace('!rmfilters', '').toLowerCase(), obj.user];

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
			let [cmd, user] = [obj.m.trim().toLowerCase(), obj.user];
			let term = cmd.replace('!rmfilter', '');

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

// freeze objects as precautionary sec measure
Object.freeze(FUZZY);
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
