let word_filters = [],
	fuzzy_filters = [];
cb.settings_choices = [
	{
		name: 'filters',
		type: 'str',
		label: 'terms for the app to silence, separated by commas',
	},
];

const CHECK_LIM = 100,
	[MAX_WHITE_SPACE, MAX_MSG_LEN] = [5, 90];

const OWNER = cb.room_slug,
	[GREEN, RED] = ['#008000', '#FF0000'];

const max_whitespace_exceeded = str => {
	for (let i = (count = 0); i < str.length; count += +(' ' === str[i++])) {
		if (count > MAX_WHITE_SPACE) return true;
	}
	return false;
};

const success = (msg, user) => cb.sendNotice(msg, user, '', GREEN);
const warn = (warning, user) => cb.sendNotice(warning, user, '', RED);
const shout = msg => cb.sendNotice(msg, '', GREEN);

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

cb.onStart(_ => {
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
	const now = new Date();
	switch (now.getUTCHours()) {
		case 5:
			if (now.getUTCMinutes() > 50) shout('FUCK OFF!!!');
			break;
		case 6:
			shout('FUCK OFF!!!');
			break;
		default:
	}
});

const addFilter = term => {
	term = term.trim();

	if (term.length > MAX_MSG_LEN || max_whitespace_exceeded(term)) {
		return;
	}

	if (word_filters.length < CHECK_LIM && word_filters.includes(term))
		return false;

	word_filters.push(term);
	word_filters = [...new Set(word_filters)];
	return true;
};

const deferredAdd = addObj => {
	if (!addObj.to_add.length) {
		word_filters = [...new Set(word_filters.concat(addObj.added))];
		return true;
	}
	const next = addObj.to_add.pop().trim();

	if (next.length > MAX_MSG_LEN || max_whitespace_exceeded(next)) {
		addObj.lorge.push(next);
	} else if (word_filters.length < CHECK_LIM && word_filters.includes(next)) {
		addObj.redundant.push(next);
	} else {
		addObj.added.push(next);
	}
	return false;
};

const rmFilter = term => {
	term = term.trim();
	if (word_filters.includes(term)) {
		word_filters = word_filters.filter(w => w !== term);
		return true;
	}
	return false;
};

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

const hasPrivileges = user => privileged().includes(user);
const msgPrivileged = msg => privileged().forEach(p => success(msg, p));

const filterMsg = msg => {
	if (hasPrivileges(msg)) return;

	const msgText = msg.m.toLowerCase();
	for (const f of word_filters) {
		if (msgText.includes(f)) {
			msg['X-Spam'] = true;

			warn(
				'your message contains a filtered word and was hidden from chat',
				msg.user
			);
			break;
		}
	}
};

let preparedCache = new Map(),
	preparedSearchCache = new Map(),
	matchesSimple = [],
	matchesStrict = [];

const isObj = x => typeof x === 'object';

const FUZZY = {
	single: function (search, target, options) {
		if (!search) return null;
		if (!isObj(search)) search = fuzzy.getPreparedSearch(search);

		if (!target) return null;
		if (!isObj(target)) target = fuzzy.getPrepared(target);

		var allowTypo =
			options && options.allowTypo !== undefined ? options.allowTypo : true;
		var algorithm = allowTypo ? fuzzy.algorithm : fuzzy.algorithmNoTypo;
		return algorithm(search, target, search[0]);
	},
	prepare: function (target) {
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
	prepareSearch: function (search) {
		if (!search) return;
		return fuzzy.prepareLowerCodes(search);
	},
	getPrepared: function (target) {
		if (target.length > 999) return fuzzy.prepare(target);
		var targetPrepared = preparedCache.get(target);
		if (targetPrepared !== undefined) return targetPrepared;
		targetPrepared = fuzzy.prepare(target);
		preparedCache.set(target, targetPrepared);
		return targetPrepared;
	},
	getPreparedSearch: function (search) {
		if (search.length > 999) return fuzzy.prepareSearch(search);
		var searchPrepared = preparedSearchCache.get(search);
		if (searchPrepared !== undefined) return searchPrepared;
		searchPrepared = fuzzy.prepareSearch(search);
		preparedSearchCache.set(search, searchPrepared);
		return searchPrepared;
	},
	algorithm: function (searchLowerCodes, prepared, searchLowerCode) {
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
						if (
							searchLowerCodes[typoStrictI] ===
							searchLowerCodes[typoStrictI + 1]
						)
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
			for (var i = matchesBestLen - 1; i >= 0; --i)
				prepared.indexes[i] = matchesBest[i];

			return prepared;
		}
	},
	algorithmNoTypo: function (searchLowerCodes, prepared, searchLowerCode) {
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
			for (var i = matchesBestLen - 1; i >= 0; --i)
				prepared.indexes[i] = matchesBest[i];

			return prepared;
		}
	},
	prepareLowerCodes: function (str) {
		var strLen = str.length;
		var lowerCodes = [];
		var lower = str.toLowerCase();
		for (var i = 0; i < strLen; ++i) lowerCodes[i] = lower.charCodeAt(i);
		return lowerCodes;
	},
	prepareBeginningIndexes: function (target) {
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
	prepareNextBeginningIndexes: function (target) {
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
	cleanup: function () {
		preparedCache.clear();
		preparedSearchCache.clear();
		matchesSimple = [];
		matchesStrict = [];
	},
};

const COMMANDS = {
	'!filters': {
		fn: _ => word_filters.join(', '),
		restricted: false,
	},
	'!addfilters': {
		fn: obj => {
			let [cmds, user] = [
				obj.m.replace('!addfilters', '').toLowerCase(),
				obj.user,
			];

			const res = {
				to_add: cmds.split(','),
				added: [],
				lorge: [],
				redundant: [],
			};
			let done = deferredAdd(res);
			while (!done) done = deferredAdd(res);

			if (res.added.length)
				msgPrivileged(`${res.added.join(', ')} added to the filter list`);

			if (res.lorge.length)
				warn(
					`${res.lorge.join(
						', '
					)} were too long to add, try splitting into smaller phrases`,
					user
				);

			if (res.redundant.length)
				warn(
					`${res.redundant.join(', ')} are already in the filter list`,
					user
				);
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
					warn(
						"it's not recommended to add long phrases, try splitting them up",
						user
					);
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
			let [cmds, user] = [
				obj.m.replace('!rmfilters', '').toLowerCase(),
				obj.user,
			];

			const res = { to_remove: cmds.split(','), removed: [], not_found: [] };

			let done = deferredRm(res);
			while (!done) done = deferredRm(res);

			if (res.removed.length)
				msgPrivileged(`${res.removed.join(', ')} removed from the filter list`);

			if (res.not_found.length)
				warn(
					`${res.not_found.join(', ')} were not found in the filter list`,
					user
				);
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

			return cmds
				.filter(cmd => {
					!COMMANDS[cmd].restricted;
				})
				.join(', ');
		},
		restricted: false,
	},
};

Object.freeze(COMMANDS);

cb.onMessage(msg => {
	for (const cmd in COMMANDS) {
		if (msg.m.trimStart().startsWith(cmd)) {
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
