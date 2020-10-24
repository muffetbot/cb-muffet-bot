/*
	TEST MOD FOR FUZZY MATCHING
*/

/*
	ADAPTATION OF FUZZYSORT NPM MODULE BY https://github.com/farzher FOR STANDALONE USE

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

let preparedCache = new Map(),
	preparedSearchCache = new Map(),
	matchesSimple = [],
	matchesStrict = [];

const isObj = x => typeof x === 'object';
const avg = arr => arr.reduce((a, c) => (a += c)) / arr.length;

const fuzzy = {
	single: function (search, target, options) {
		if (!search) return null;
		if (!isObj(search)) search = fuzzy.getPreparedSearch(search);

		if (!target) return null;
		if (!isObj(target)) target = fuzzy.getPrepared(target);

		var allowTypo = options && options.allowTypo !== undefined ? options.allowTypo : true;
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
		}; // hidden
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
						if (searchLowerCodes[typoStrictI] === searchLowerCodes[typoStrictI + 1]) continue;
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
				if (typoSimpleI !== 0) score += -20; /*typoPenalty*/
			} else {
				if (typoStrictI !== 0) score += -20; /*typoPenalty*/
			}
			score -= targetLen - searchLen;
			prepared.score = score;
			prepared.indexes = new Array(matchesBestLen);
			for (var i = matchesBestLen - 1; i >= 0; --i) prepared.indexes[i] = matchesBest[i];

			return prepared;
		}
	},
	algorithmNoTypo: function (searchLowerCodes, prepared, searchLowerCode) {
		var targetLowerCodes = prepared._targetLowerCodes;
		var searchLen = searchLowerCodes.length;
		var targetLen = targetLowerCodes.length;
		var searchI = 0; // where we at
		var targetI = 0; // where you at
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
			if (targetI >= targetLen) return null; // Failed to find searchI
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
						console.log(searchI, searchLen);
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
				nextBeginningIndexes[i] = lastIsBeginning === undefined ? targetLen : lastIsBeginning;
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

const TEST_MSG = 'Hi first time in your how room miss muffet, are you new? old are you?';
const FUZZY_ARGS = 'how firts muffet giraffe lights'.split(' ');

function test() {
	const stats = {
		scores: [],
		get pos_scores() {
			return this.scores.filter(Boolean) || new Error('no matches');
		},
		get match_ratio() {
			return this.pos_scores.length / this.scores.length;
		},
		get mean() {
			return avg(this.scores);
		},
		get match_mean() {
			return avg(this.pos_scores);
		},
		get min_max() {
			const pos = this.pos_scores;
			return [Math.min(...pos), Math.max(...pos)];
		},
		get range() {
			const [min, max] = this.min_max;
			return max - min;
		},
		get std_deviation() {
			const mean = this.mean;
			const variance = avg(this.scores.map(s => Math.pow(s - mean, 2)));
			return Math.sqrt(variance);
		},
		get match_std_deviation() {
			const mean = this.match_mean;
			const variance = avg(this.pos_scores.map(s => Math.pow(s - mean, 2)));
			return Math.sqrt(variance);
		},
		get z_scores() {
			const mean = this.mean,
				std_dev = this.std_deviation;
			return this.scores.map(s => s - mean / std_dev);
		},
		get match_z_scores() {
			const mean = this.match_mean,
				std_dev = this.match_std_deviation;
			return this.scores.map(s => s - mean / std_dev);
		},
	};

	for (const q of FUZZY_ARGS) {
		const query = fuzzy.single(q, TEST_MSG, { allowTypo: true });
		stats.scores.push(query?.score ?? 0);
	}

	return stats;
}

const results = test();
console.table(results);
