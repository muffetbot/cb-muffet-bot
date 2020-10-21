let word_filters = [];
cb.settings_choices = [
	{
		name: 'filters',
		type: 'str',
		label: 'terms for the app to silence, separated by commas',
	},
];

const CHECK_LIM = 100,
	MAX_WHITE_SPACE = 5;

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

const privileged = () => {
	const have = [OWNER];
	cb.getRoomUsersData(data => {
		if (!data.success) {
			warn('unable to get user data', OWNER);
			return have;
		}

		have.concat(data.data.moderator);
	});
	return have;
};

cb.onStart(_ => {
	const filter_settings = cb.settings.filters;
	word_filters = filter_settings.split(', ');
});

const addFilter = term => {
	term = term.trim();

	if (max_whitespace_exceeded(term)) {
		return;
	}

	if (word_filters.length < CHECK_LIM && word_filters.includes(term))
		return false;

	word_filters.push(term);
	word_filters = [...new Set(word_filters)];
	return true;
};

const rmFilter = term => {
	term = term.trim();
	if (word_filters.includes(term)) {
		word_filters = word_filters.filter(w => w !== term);
		return true;
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

const COMMANDS = {
	'!filters': {
		fn: obj => {
			let user = obj.user;
			success(word_filters.join(', '), user);
		},
		restricted: false,
	},
	'!addfilters': {
		fn: obj => {
			let [cmds, user] = [
				obj.m.replace('!addfilters', '').toLowerCase(),
				obj.user,
			];

			const res = cmds.split(',').reduce(
				(acc, curr) => {
					curr = curr.trim();
					switch (addFilter(curr)) {
						case true:
							acc.added.push(curr);
							break;
						case undefined:
							acc.lorge.push(curr);
							break;
						default:
							acc.redundant.push(curr);
					}
					return acc;
				},
				{ added: [], lorge: [], redundant: [] }
			);

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
			let [cmd, user] = [obj.m.toLowerCase(), obj.user];
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
	'!rmfilter': {
		fn: obj => {
			let [cmd, user] = [obj.m.toLowerCase(), obj.user];
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
	msg.m.trim();

	for (const cmd in COMMANDS) {
		if (msg.m.startsWith(cmd)) {
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
