const tmi = require('tmi.js');
const io = require('socket.io-client');
const socket = io.connect('http://localhost:3100');
const fs = require('fs');

let config = require('./config.json');

const guildFile = config.devMode ? './dev/guilds.json' : './jsons/guilds.json';
const backupGuildFile = './backup/guilds.json';
let guilds = require(guildFile);

const userFile = config.devMode ? './dev/users.json' : './jsons/users.json';
const backupUserFile = './backup/users.json';
let users = require(userFile);

const realmFile = config.devMode ? './dev/realm.json' : './jsons/realm.json';
const backupRealmFile = './backup/realm.json';
let realm = require(realmFile);

/**
 * Create a backup at every launch
 */
function doBackup() {
    saveGuilds(true);
    saveUsers(true);
    saveRealm(true);
}

//First : Launch the backup.
doBackup();

let messageQueue = [];

// Create a client with our options
const client = new tmi.client(config.botInfos);

// Register our event handlers (defined below)
client.on('message', onMessageHandler);
client.on('connected', onConnectedHandler);

// Connect to Twitch:
client.connect();

updateGuildLevels();

/**
 * Action when a guild is paid.
 */
socket.on(
    'changeGuild',
    function (infos) {
        if (config.devMode || (!config.devMode && config.currentUser !== infos.user)) {
            instanciateUser(infos.user);
            let guild = guilds[infos.guild];
            let userGuild = getUserGuild(infos.user);
            users[infos.user].isMaster = false;

            if (userGuild !== infos.guild) {
                let previousGuild = addToGuild(infos.user, infos.guild);

                messageQueue.push(`${infos.user} rejoint la guilde ${guild.longText}. ${guild.emote}`);

                if (null !== previousGuild) {
                    messageQueue.push(`La guilde ${previousGuild.longText} pleure le départ d'un de ses membres.`);
                }
            } else {
                let newLevel = increaseUserLevel(infos.user);
                messageQueue.push(`${infos.user} renforce son allégence à la guilde ${guild.longText}. ${guild.emote} (Niveau ${newLevel})`);
            }

            updateGuildMasters();
            updateGuildLevels();

            saveGuilds();
            saveUsers();
        }
    }
);

/**
 * Action when a poison is used.
 */
socket.on(
    'poison',
    function (infos) {
        if (config.devMode || (!config.devMode && config.currentUser !== infos.user)) {
            instanciateUser(infos.user);
            if (isPoisonPossible(infos.user)) {
                if ("" === users[infos.user].guild) {
                    messageQueue.push(`Désolé, seul les membres d'une guilde ont les ressources nécéssaires pour se fournir en poison. Tu peux demander un remboursement de tes points.`);
                } else {
                    let victim = chooseSomeoneRandom();
                    users[victim].level--;

                    if (infos.user === victim) {
                        messageQueue.push(`Malheureusement, en essayant d'empoisonner ses rivaux, ${infos.user} fait tomber la fiole et se coupe avec le verre. Le poison pénètre par la plaie fraiche et ${infos.user} sombre dans l'inconscience.`);
                    } else {
                        messageQueue.push(`${infos.user} s'approche perfidement de ${victim} et dépose quelques gouttes de poison dans la bière qu'il·elle tenait à la main. Quelques heures plus tard, croyant être ivre, ${victim} s'effondre dans son lit. Il·Elle ne se réveille que 3 jours plus tard, plus faible que jamais.`);
                    }
                }
            }
        }

        updateGuildMasters();
        updateGuildLevels();

        saveGuilds();
        saveUsers();
    }
);

/**
 * Listen to the chat and act depending on the command asked.
 *
 * @param target
 * @param context
 * @param msg
 * @param self
 */
function onMessageHandler(target, context, msg, self) {
    if (self) {
        return;
    } // Ignore messages from the bot

    // Remove whitespace from chat message
    const commandName = msg.trim();

    if ('!' === commandName.charAt(0)) {
        if (config.devMode || (!config.devMode && config.currentUser !== context['display-name'])) {
            let user = context['display-name'];
            instanciateUser(user);

            // If the command is known, let's execute it
            if (commandName === '!guilde') {
                getStatsOfUser(user);
            } else if (commandName === '!eau') {
                getStatsOfGuild('water');
            } else if (commandName === '!feu') {
                getStatsOfGuild('fire');
            } else if (commandName === '!terre') {
                getStatsOfGuild('earth');
            } else if (commandName === '!air') {
                getStatsOfGuild('air');
            } else if (commandName === '!lumière') {
                getStatsOfGuild('light');
            } else if (commandName === '!ténèbres') {
                getStatsOfGuild('darkness');
            } else if (commandName === '!roi') {
                displayKing();
            } else {
                if (userExist(commandName.substring(1))) {
                    getStatsOfUser(commandName.substring(1));
                } else {
                    console.log(`* Unknown command ${commandName}`);
                }
            }
        }
    }
}

/**
 * Recalculate the actual rank of each guilds
 */
function updateGuildLevels() {
    for (let g in guilds) {
        let guild = guilds[g];
        let people = guild.members;

        if (0 === people.length) {
            guild.level = 0;
        } else {
            let guildLevel = 0;
            people.forEach((member) => {
                guildLevel = guildLevel + users[member].level;
            });

            guild.level = guildLevel;
        }
    }

    saveGuilds();

    updateKing();
}

/**
 * Update the current King.
 */
function updateKing() {
    let bestGuild = {
        "master": "",
        "guild": null,
        "level": -1
    }

    for (let g in guilds) {
        let guild = guilds[g];

        if (guild.level > 0 && guild.master) {
            if (guild.level > bestGuild.level) {
                bestGuild.master = guild.master;
                bestGuild.level = guild.level;
                bestGuild.guild = g;
            }
        }
    }

    if (bestGuild.level > realm.kingLevel) {
        let oldKing = {
            "king": realm.king,
            "guild": realm.kingGuild
        };

        realm.king = bestGuild.master;
        realm.kingLevel = bestGuild.level;
        realm.kingGuild = bestGuild.guild;

        if (oldKing.king !== realm.king) {
            let message = `Habitant·e·s du Royaume ... aujourd'hui est un grand jour. La guilde ${guilds[bestGuild.guild].longText} a fait croitre sa notoriété jusqu'a devenir la plus influente. Son·Sa Maître·sse ${realm.king} est donc placé à la tête du royaume. Acclamez votre nouveau·elle Souverain·e !`;

            if ("" !== oldKing.king) {
                message += ` Souvenez vous de ce jour, festoyez, mais restez vigilants, ${oldKing.king} le·la déchu·e ne laissera probablement pas passer l'affront et fera tout pour redorer l'image de la guilde ${guilds[oldKing.guild].longText}.`;
            }
            messageQueue.push(message)
        }

    }

    saveRealm();
}

/**
 * check if the poisonner AND someone else can be poisoned
 *
 * @returns {boolean}
 */
function isPoisonPossible(poisoner) {
    let counter = 0;

    if (users[poisoner]) {
        if ('' === users[poisoner].guild || users[poisoner].level < 2) {
            messageQueue.push(`Vous n'avez pas l'experience nécéssaire pour utiliser du poison. Vous pouvez demander un refund.`)
            return false;
        }
    }

    for (user in users) {
        if (user !== poisoner && '' !== users[user].guild && users[user].level >= 2) {
            return true;
        }
    }

    messageQueue.push(`Personne dans le royaume n'a un statut assez élevé pour mériter les quelques deniers que coûte un poison, tu peux demander un remboursement.`);
    return false;
}

/**
 * Randomly select ANYONE in the realm (including yourself)
 *
 * @returns {string|*}
 */
function chooseSomeoneRandom() {
    let totalUsers = Object.keys(users).length;
    let key = Math.floor(Math.random() * totalUsers);

    let counter = 0;
    for (user in users) {
        if (key === counter) {
            if ('' === users[user].guild || users[user].level < 2) {
                return chooseSomeoneRandom();
            }
            return user;
        }

        counter++;
    }
}

/**
 * Function called ever 1.5s to handle the limit of IRC.
 */
function sendMessage() {
    if (messageQueue.length > 0) {
        let message = messageQueue.shift();
        client.say(client.channels[0], '/me ' + message);
    }
}

/**
 * Reaclculate EVERY guild master and update them in the json file.
 */
function updateGuildMasters() {
    //reset all flags.
    for (user in users) {
        users[user].isMaster = false;
    }

    //Parse each guild
    for (iterrateGuild in guilds) {
        let guild = guilds[iterrateGuild];
        let people = guild.members;

        if (0 === people.length && '' !== guild.master) {
            //No more master.
            guild.master = "";
            messageQueue.push(`La guilde ${guild.longText} perd son·sa Maître·sse et personne n'a les épaules pour prendre la relève ... qui sera assez vaillant.e ?`);
        } else if (0 < people.length) {
            let master = getMasterOfGuild(guild);
            if (master !== guild.master) {
                //New guild master
                guild.master = master;
                messageQueue.push(`Acclamez tous ${master} le·la nouveau·elle Maître·esse de la guilde ${guild.longText} !`);
            }

            users[master].isMaster = true;
        }
    }
}

/**
 * Query the master of a guild and return his name.
 *
 * @param guild
 * @returns {string}
 */
function getMasterOfGuild(guild) {
    let bestLevel = {
        "user": "",
        "level": -1
    }

    guild.members.forEach((member) => {
        let userLevel = getUserLevel(member);
        if (userLevel > bestLevel.level) {
            bestLevel.user = member;
            bestLevel.level = userLevel;
        }
    });

    return bestLevel.user;
}

/**
 * Check if a user does exist in the JSON.
 *
 * @param user
 * @returns {boolean}
 */
function userExist(user) {
    for (let u in users) {
        if (user === u) {
            return true;
        }
    }

    return false;
}

/**
 * Answer the type of user (master/other) and it's level.
 *
 * @param user
 */
function getStatsOfUser(user) {
    let stats = users[user];
    let message = '';
    if ("" !== stats.guild) {
        let guild = guilds[stats.guild];
        if (stats.isMaster) {
            message = `${user} est le·la grand·e Maître·sse de la guilde ${guild.longText}. (Niveau ${stats.level})`;
        } else {
            let guildMaster = getMasterOfGuild(guild);
            message = `${user} est un·e disciple (Niveau ${stats.level}) de la guilde ${guild.longText} sous les ordres de ${guildMaster}`
        }
    } else {
        message = `${user} ? Hmm qui est cet·te iconnu·e qui se promène dans mon royaume ? Prens un siège et rejoins une guilde via les points de chaine :)`;
    }

    messageQueue.push(message);
}

/**
 * Affiche le roi actuel.
 */
function displayKing() {
    messageQueue.push(`Le Royaume est actuellement dirigé par ${realm.king}, qui est égallement à la tête de la guilde la plus puissante du royaume: celle ${guilds[realm.kingGuild].longText}`)
}

/**
 * Print a message explaining the current status (master etc) of the specified guild.
 *
 * @param guildName
 */
function getStatsOfGuild(guildName) {
    let message = '';
    let guild = guilds[guildName];
    if (guild.master) {
        switch (guildName) {
            case 'water':
                message = `Depuis sa citée engloutie, ${guild.master} le bras droit de Poséidon dirige la guilde de l'eau.`
                break;
            case 'earth':
                message = `Au sommet de la plus haute montagne du continent, trône le·la puissant·e ${guild.master}, le·la grand·e Maître·sse de la guilde de la terre.`
                break;
            case 'fire':
                message = `Dans sa forge au centre d'un volcan, ${guild.master} le·la vieux·ielle forgeron·ne des dieux règne sur la guilde du feu.`
                break;
            case 'air':
                message = `Loin au dessus de la terre, perché dans les nuages, ${guild.master} l'Avatar observe la vie terrestre avec curiosité.`
                break;
            case 'light':
                message = `Réfugié sur le soleil depuis des siècles, loin des troubles de la vie humaine, ${guild.master} le·la puissant·te règne sans partage sur la guilde de la lumière.`
                break;
            case 'darkness':
                message = `Caché au fond d'un gouffre sans fond sur la lointaine planète Mars, ${guild.master} le·la terrifiant·e règne sur les morts et la guilde des ténèbres.`
                break;
        }

        let members = guild.members.length;
        if (members === 1) {
            message += ` Malheureusement il·elle peine encore à recruter et ne possède aucun disciple.`;
        } else if (members === 2) {
            message += ` Accompagné de son·sa seul·e disciple, il·elle cherche toujours du sang frais pour venir grossir les rangs.`;
        } else if (members > 2) {
            message += ` Il·Elle est secondé·e par ses ${members} disciples a qui il·elle tente d'enseigner toutes les subtilitées de son art.`;
        }

        message += ` (Niveau de la guilde : ${guild.level})`;

        messageQueue.push(message);
    } else {
        switch (guildName) {
            case 'water':
                message = `Au fond d'une citée engloutie, se cache le secret de la guilde de l'eau.`
                break;
            case 'earth':
                message = `Au sommet de la plus haute montagne du continent, se cache le secret de la guilde de la terre.`
                break;
            case 'fire':
                message = `Dans une forge au centre d'un volcan, se cache le secret de la guilde du feu.`
                break;
            case 'air':
                message = `Loin au dessus de la terre, quelque part dans les nuages, se cache le secret de la guilde de l'air.`
                break;
            case 'light':
                message = `Le secret de la guilde de la lumière se cache quelque part sur le soleil.`
                break;
            case 'darkness':
                message = `Le secret de la guilde des ténèbres se cache quelque part sur mars.`
                break;
        }

        message += ` Qui sera assez aventureux pour en devenir le·la Maître·sse ?`;

        messageQueue.push(message);
    }
}

/**
 * Return the current guild of an user.
 *
 * @param user
 * @returns {string|*}
 */
function getUserGuild(user) {
    return users[user].guild;
}

/**
 * Return the current level of an user.
 *
 * @param user
 * @returns {*}
 */
function getUserLevel(user) {
    return users[user].level;
}

/**
 * Add a user to the specified guild and eject him from his old one.
 *
 * @param user
 * @param guild
 * @returns {null}
 */
function addToGuild(user, guild) {
    let previousGuild = null;

    for (let jsonGuild in guilds) {
        if (jsonGuild === guild) {
            if (!guilds[jsonGuild].members.includes(user)) {
                guilds[jsonGuild].members.push(user);
                updateUserGuild(user, jsonGuild);
            }
        } else {
            const index = guilds[jsonGuild].members.indexOf(user);
            if (index > -1) {
                previousGuild = guilds[jsonGuild];
                guilds[jsonGuild].members.splice(index, 1);
            }
        }
    }

    return previousGuild;
}

/**
 * Tech function to set a new guild.
 *
 * @param user
 * @param guild
 */
function updateUserGuild(user, guild) {
    console.log('test');
    users[user].guild = guild;
    users[user].level = 1;
}

/**
 * Add one tu the current user level.
 *
 * @param user
 * @returns {*}
 */
function increaseUserLevel(user) {
    users[user].level++;

    return users[user].level;
}

/**
 * Create the user if not existant.
 *
 * @param user
 */
function instanciateUser(user) {
    if (undefined === users[user]) {
        users[user] = {
            "guild": "",
            "isMaster": false,
            "level": 0
        };
    }
}

/**
 * Update the guilds JSON.
 */
function saveGuilds(backup = false) {
    let file = backup ? backupGuildFile : guildFile;
    fs.writeFile(file, JSON.stringify(guilds), function writeJSON(err) {
        if (err) {
            return console.log(err);
        }
    });
}

/**
 * Update the users JSON.
 */
function saveUsers(backup = false) {
    let file = backup ? backupUserFile : userFile;
    fs.writeFile(file, JSON.stringify(users), function writeJSON(err) {
        if (err) {
            return console.log(err);
        }
    });
}

/**
 * Update the realm JSON.
 */
function saveRealm(backup = false) {
    let file = backup ? backupRealmFile : realmFile;
    fs.writeFile(file, JSON.stringify(realm), function writeJSON(err) {
        if (err) {
            return console.log(err);
        }
    });
}

// Called every time the bot connects to Twitch chat
function onConnectedHandler(addr, port) {
    console.log(`* Connected to ${addr}:${port}`);
}

setInterval(sendMessage, 1500);