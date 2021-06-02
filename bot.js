const tmi = require('tmi.js');
const io = require('socket.io-client');
const fs = require('fs');

var app = require('express')();
var express = require('express');
var path = require('path');

var http = require('http').createServer(app);
var ioServ = require('socket.io')(http);

const { Random } = require("random-js");
const random = new Random(); // uses the nativeMath engine

ioServ.on('connection', function(socket){
    console.log('page connected.')
});

app.use(express.static(path.join(__dirname, 'views')));

let config = require('./config.json');

const socket = io.connect(config.nodecgHost);

const guildFile = config.devMode ? './dev/guilds.json' : './jsons/guilds.json';
const guildFullFile = __dirname + '/' + (config.devMode ? 'dev/' : 'jsons/') + "guilds.json";
const backupGuildFile = './backup/guilds.json';
let guilds = require(guildFile);

const userFile = config.devMode ? './dev/users.json' : './jsons/users.json';
const userFullFile = __dirname + '/' + (config.devMode ? 'dev/' : 'jsons/') + "users.json";
const backupUserFile = './backup/users.json';
let users = require(userFile);

const realmFile = config.devMode ? './dev/realm.json' : './jsons/realm.json';
const realmFullFile = __dirname + '/' + (config.devMode ? 'dev/' : 'jsons/') + "realm.json";
const backupRealmFile = './backup/realm.json';
let realm = require(realmFile);

http.listen(config.port, function(){
    console.log('listening on *:' + config.port);
});

app.get('/generic/', function(req, res){
    res.sendFile(__dirname + '/views/generic.html');
});

app.get('/classement/', function(req, res){
    res.sendFile(__dirname + '/views/classement.html');
});

app.get('/total/', function(req, res){
    res.sendFile(__dirname + '/views/total.html');
    setTimeout(function () {
        ioServ.emit(
            'updateLevel',
            countTotalLevels()
        );
    }, 1000)
});

app.get('/events/', function(req, res){
    res.sendFile(__dirname + '/views/events.html');
});

app.get('/guilds.json', function(req, res){
    res.sendFile(guildFullFile);
});

app.get('/users.json', function(req, res){
    res.sendFile(userFullFile);
});

app.get('/realm.json', function(req, res){
    res.sendFile(realmFullFile);
});

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

updateGuildMasters();
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

                if (realm.king === infos.user) {
                    realm.kingGuild = infos.guild;
                }

                ioServ.emit(
                    'displayEvent',
                    {
                        'event': 'joinGuild',
                        'user': infos.user,
                        'data': {
                            "guild": guilds[infos.guild]
                        }
                    }
                );
            } else {
                let oldLevel = users[infos.user].level
                let levels = generateNumberOfLevel();
                let newLevel = increaseUserLevel(infos.user, levels);
                messageQueue.push(`${infos.user} (${oldLevel} -> ${newLevel} / +${levels}) renforce son allégeance à la guilde ${guild.longText}. ${guild.emote}`);

                ioServ.emit(
                    'displayEvent',
                    {
                        'event': 'upGuild',
                        'user': infos.user,
                        'data': {
                            "guild": guilds[infos.guild]
                        }
                    }
                );
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

                    ioServ.emit(
                        'displayEvent',
                        {
                            'event': 'poisonUsage',
                            'user': infos.user,
                            'data': {
                                "victim": victim
                            }
                        }
                    );
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
 * King slay
 */
socket.on(
    'kingSlayer',
    function (infos) {
        if (config.devMode || (!config.devMode && config.currentUser !== infos.user)) {
            instanciateUser(infos.user);

            if (!realm.kingSlayer) {
                realm.kingSlayer = config.kingSlayerCost;
            } else {
                realm.kingSlayer = realm.kingSlayer + config.kingSlayerCost;
            }


            if (realm.kingSlayer >= config.kingSlayerNeeded) {
                //King is dead.
                messageQueue.push(`Un régicide a eu lieu. ${realm.king} est mort·e.`);
                realm.kingSlayer = 0;
                realm.kingLevel = 0;
                users[realm.king].level = 1;
            } else {
                messageQueue.push(`${infos.user} complote contre ${realm.king}. La trahison progresse (${realm.kingSlayer}/${config.kingSlayerNeeded}).`);
            }
        }

        updateGuildMasters();
        updateGuildLevels();

        saveGuilds();
        saveUsers();
        saveRealm();
    }
);

/**
 * King defense
 */
socket.on(
    'kingGuard',
    function (infos) {
        if (config.devMode || (!config.devMode && config.currentUser !== infos.user)) {
            instanciateUser(infos.user);

            if (!realm.kingSlayer) {
                realm.kingSlayer = 0;
            } else {
                realm.kingSlayer = Math.max((realm.kingSlayer - config.kingSlayerCost), 0);
            }

            messageQueue.push(`${infos.user} s'enrôle dans l'armée du roi. La trahison ralentit (${realm.kingSlayer}/${config.kingSlayerNeeded}).`);
        }

        saveRealm();
    }
);

socket.on(
    'chaosPotion',
    function (infos) {
        randomPotion(infos);
    }
);

socket.on(
    'grub',
    function (infos) {
        if (config.devMode || (!config.devMode && config.currentUser !== infos.user)) {
            instanciateUser(infos.user);

            let user = chooseSomeoneRandom(true);
            let levelsIncrease = random.integer(1, 10);

            users[user].level = users[user].level + levelsIncrease;
            messageQueue.push(`Un grub a été sauvé (${infos.total}/46), papa grub donne ${levelsIncrease} niveaux à ${user}.`);
        }

        updateGuildMasters();
        updateGuildLevels();

        saveGuilds();
        saveUsers();
        saveRealm();
    }
);

socket.on(
    'papaGrub',
    function (infos) {
        if (config.devMode || (!config.devMode && config.currentUser !== infos.user)) {
            instanciateUser(infos.user);

            messageQueue.push(`BRAVO !! Papa grub a retrouvé tout ses petits, ils vous remercie abondamment !!!`)
            for (let i = 0; i < 10; i++) {
                let user = chooseSomeoneRandom(true);
                let levelsIncrease = random.integer(1, 10);

                let levelText = 'niveaux'
                if (1 === levelsIncrease) {
                    levelText = 'niveau'
                }

                users[user].level = users[user].level + levelsIncrease;
                messageQueue.push(`Papa grub donne ${levelsIncrease} ${levelText} à ${user}.`);
            }
        }

        updateGuildMasters();
        updateGuildLevels();

        saveGuilds();
        saveUsers();
        saveRealm();
    }
);

function randomPotion(infos) {
    if (config.devMode || (!config.devMode && config.currentUser !== infos.user)) {
        instanciateUser(infos.user);

        doBackup();
        console.log('BACKUP DONE');

        //choose effect
        let percentage = random.integer(1, 100);
        console.log(`Dice : ${percentage}`);
        if (percentage <= 5) {
            console.log('5% -> Shuffle EVERYTHING');
            chaosPotion();
        } else if (5 < percentage && 13 >= percentage) {
            console.log(`8% -> equality`);
            equalityPotion();
        } else if (13 < percentage && 28 >= percentage) {
            console.log(`15% -> transmutation`);
            transmutationPotion();
        } else if (28 < percentage && 43 >= percentage) {
            console.log('15% -> Changement de guilde');
            mutationPotion();
        } else if (43 < percentage && 58 >= percentage) {
            console.log('15% -> PLAGUE');
            plaguePotion();
        } else if (58 < percentage && 75 >= percentage) {
            console.log(`17% -> king vampirism`);
            kingVampirismePotion();
        }  else if (75 < percentage) {
            console.log('25% -> level Rain');
            christmasPotion();
        }
    }

    updateGuildMasters();
    updateGuildLevels();

    saveGuilds();
    saveUsers();
    saveRealm();
}

function kingVampirismePotion() {
    let vampir = chooseSomeoneRandom(true);
    while (vampir === realm.king) {
        vampir = chooseSomeoneRandom(true);
    }
    let levelSteal = random.integer(1, 10);
    levelSteal = Math.min(levelSteal, (users[realm.king].level - 1));

    let oldVampireLevel = users[vampir].level;
    let oldKingLevel = users[realm.king].level;

    let levelText = 'niveaux'
    if (1 === levelSteal) {
        levelText = 'niveau'
    }

    realm.kingLevel -= levelSteal;
    users[realm.king].level -= levelSteal;
    users[vampir].level += levelSteal;

    messageQueue.push(`[POTION DE VAMPIRISME ROYAL] ${vampir} (${oldVampireLevel} -> ${users[vampir].level}) absorbe la force royale de ${realm.king} (${oldKingLevel} -> ${users[realm.king].level}) et lui vole ${levelSteal} ${levelText}.`);
}

function equalityPotion() {
    let totalLevels = countTotalLevels();
    let totalUsers = countTotalUsers();
    console.log('[EQUALITY] Total levels: '+ totalLevels);

    realm.king = '';
    realm.kingLevel = -1;

    let equalLevels = Math.floor(totalLevels / totalUsers);

    for (user in users) {
        users[user].level = equalLevels;
    }

    messageQueue.push(`[POTION D'EGALITE] Le royaume se partage équitablement les niveaux.`);
}

function transmutationPotion() {
    let user1 = chooseSomeoneRandom(true);
    let user2 = chooseSomeoneRandom(true);
    while (user1 === user2) {
        user2 = chooseSomeoneRandom(true);
    }

    let user1Level = users[user1].level;
    let user2Level = users[user2].level;

    users[user1].level = user2Level;
    users[user2].level = user1Level;

    messageQueue.push(`[POTION DE TRANSMUTATION] ${user1} (${user1Level} -> ${user2Level}) et ${user2} (${user2Level} -> ${user1Level}) échangent leurs forces.`);
}

function luckPotion() {
    let user = chooseSomeoneRandom(true);
    let levelsIncrease = random.integer(1, 10);

    let levelText = 'niveaux'
    if (1 === levelsIncrease) {
        levelText = 'niveau'
    }

    users[user].level = users[user].level + levelsIncrease;
    messageQueue.push(`[POTION DE CHANCE] ${user} gagne ${levelsIncrease} ${levelText} (${users[user].level}).`);
}

function sadnessPotion() {
    let user = chooseSomeoneRandom(true);
    let levelsIncrease = random.integer(1, 10);

    let newLevel = users[user].level - levelsIncrease;
    let levelDif = levelsIncrease;
    if (newLevel < 1) {
        newLevel = 1;
        levelDif = users[user].level - 1;
    }
    users[user].level = newLevel;
    let levelText = 'niveaux'
    if (1 === levelDif) {
        levelText = 'niveau'
    }

    messageQueue.push(`[POTION DE TRISTESSE] ${user} perd ${levelDif} ${levelText} (${users[user].level}).`);
}

function patriotPotion() {
    let multiplicator = random.integer(1, 3);
    let multiPop = multiplicator * config.kingSlayerCost;
    if (!realm.kingSlayer) {
        realm.kingSlayer = 0;
    } else {
        realm.kingSlayer = Math.max((realm.kingSlayer - multiPop), 0);
    }

    messageQueue.push(`[POTION DE PATRIOTISME] La trahison ralentit ${multiplicator} fois (${realm.kingSlayer}/${config.kingSlayerNeeded}).`);
}

function anarchyPotion() {
    let multiplicator = random.integer(1, 3);
    let multiPop = multiplicator * config.kingSlayerCost;


    if (!realm.kingSlayer) {
        realm.kingSlayer = multiPop;
    } else {
        realm.kingSlayer = realm.kingSlayer + multiPop;
    }

    if (realm.kingSlayer >= config.kingSlayerNeeded) {
        //King is dead.
        messageQueue.push(`[POTION D'ANARCHIE] La trahison progresse.`);
        messageQueue.push(`Un régicide a eu lieu. ${realm.king} est mort·e.`);
        realm.kingSlayer = 0;
        realm.kingLevel = 0;
        users[realm.king].level = 1;
    } else {
        messageQueue.push(`[POTION D'ANARCHIE] La trahison progresse ${multiplicator} fois (${realm.kingSlayer}/${config.kingSlayerNeeded}).`);
    }
}

function mutationPotion() {
    let user = chooseSomeoneRandom(true);
    let newGuild = chooseGuildRandom();

    if (newGuild === users[user].guild) {
        messageQueue.push(`[POTION DE MUTATION] ${user} a été choisi par la potion, mais sa volonté était trop forte, il·elle reste dans sa guilde.`);
    } else {
        addToGuild(user, newGuild, true);

        messageQueue.push(`[POTION DE MUTATION] ${user} transfert ses connaissance vers la guilde ${guilds[newGuild].longText}.`);
    }
}

function plaguePotion() {
    let guild = chooseGuildRandom();
    let people = guilds[guild].members;

    messageQueue.push(`[POTION DE PESTE] La peste frappe la guilde ${guilds[guild].longText}.`);


    people.forEach((member) => {
        users[member].level;

        let levelsDecrease = random.integer(1, 5);

        let newLevel = users[member].level - levelsDecrease;
        let levelDif = levelsDecrease;
        if (newLevel < 1) {
            newLevel = 1;
            levelDif = users[member].level - 1;
        }
        users[member].level = newLevel;
        let levelText = 'niveaux'
        if (1 === levelDif) {
            levelText = 'niveau'
        }

        messageQueue.push(`[POTION DE PESTE] ${member} perd ${levelDif} ${levelText} (${users[member].level}).`);
    });
}

function christmasPotion() {
    for (let i = 0; i < 10; i++) {
        let user = chooseSomeoneRandom(true);
        let levelsIncrease = random.integer(1, 10);

        let levelText = 'niveaux'
        if (1 === levelsIncrease) {
            levelText = 'niveau'
        }

        users[user].level = users[user].level + levelsIncrease;
        messageQueue.push(`[POTION DE NOËL] ${user} gagne ${levelsIncrease} ${levelText} (${users[user].level}).`);
    }
}

function chaosPotion() {
    let totalLevels = countTotalLevels();
    let totalUsers = countTotalUsers();
    console.log('[SHUFFLE] Total levels: '+ totalLevels);

    realm.king = '';
    realm.kingLevel = -1;

    let usersArr = [];
    for (user in users) {
        if (users[user].guild != "") {
            usersArr.push(user);
        }
    }
    shuffle(usersArr);

    let counter = 1;
    let remainingLevels = totalLevels - totalUsers;
    usersArr.forEach(function (item, index) {
        if (counter === totalUsers) {
            users[item].level = 1 + remainingLevels;
            console.log(`[SHUFFLE] ${item} - Niveau ${users[item].level}`);
        } else {
            if (remainingLevels > 0) {
                let levelLimit = Math.floor(remainingLevels/3);
                let levelToAdd = random.integer(1, remainingLevels);
                levelToAdd = Math.min(levelLimit, levelToAdd);
                users[item].level = 1 + levelToAdd;
                remainingLevels -= levelToAdd;
                console.log(`[SHUFFLE] ${item} - Niveau ${users[item].level}`);
            } else {
                users[item].level = 1;
                console.log(`[SHUFFLE] ${item} - Niveau ${users[item].level}`);
            }
        }

        let guild = chooseGuildRandom();
        addToGuild(item, guild, true);
        console.log(`[SHUFFLE] ${item} - Guilde ${users[item].guild}`);

        counter++;
    });

    messageQueue.push(`[POTION DE CHAOS] Peut être devrierez vous vérifier votre état ?`);
}

function shuffle(array) {
    array.sort(() => Math.random() - 0.5);
}

function chooseGuildRandom() {
    let guildsList = ['water', 'earth', 'fire', 'air', 'light', 'darkness']
    let newGuildId = random.integer(0, 5);

    return guildsList[newGuildId];
}

function countTotalLevels() {
    let totalLevel = 0;
    for (user in users) {
        if (users[user].guild !== '') {
            totalLevel += users[user].level;
        }
    }

    return totalLevel;
}

function countTotalUsers() {
    let totalUsers = 0;
    for (user in users) {
        if (users[user].guild !== '') {
            totalUsers++;
        }
    }

    return totalUsers;
}

/**
 * @returns {number}
 */
function generateNumberOfLevel() {
    let percentage = random.integer(1, 100);

    if (percentage <= 70) {
        //70% -> 1
        return 1;
    } else if (70 < percentage && 80 >= percentage) {
        //10% -> 2
        return 2;
    } else if (80 < percentage && 85 >= percentage) {
        //5% -> 3
        return 3;
    } else if (85 < percentage && 90 >= percentage) {
        //5% -> 4
        return 4;
    } else if (90 < percentage && 93 >= percentage) {
        //3% -> 5
        return 5;
    } else if (93 < percentage && 96 >= percentage) {
        //3% -> 6
        return 6;
    } else if (96 < percentage && 98 >= percentage) {
        //2% -> 7
        return 7;
    } else if (98 < percentage && 99 >= percentage) {
        //1% -> 8
        return 8;
    } else if (100 === percentage) {
        //1% -> 9
        return 9;
    }
}

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
        if (config.currentUser === 'Djodjino') {
            if (commandName === '!go') {
                messageQueue.push(`Attend Djo, on nourrit les canards.`)
            }
        }

        let user = context['display-name'];
        if (config.devMode || (!config.devMode && config.currentUser !== context['display-name'])) {
            instanciateUser(user);
        }

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
        } else if (commandName === '!complot') {
            displayComplot();
        } else if (commandName === '!royaume') {
            displayRoyaume();
        } else {
            if (userExist(commandName.substring(1))) {
                getStatsOfUser(commandName.substring(1));
            } else {
                console.log(`* Unknown command ${commandName}`);
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

    if (realm.kingLevel !== -1) {
        realm.kingLevel = guilds[realm.kingGuild].level;
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
            let message = `${realm.king} (${users[realm.king].level}) de la guilde ${guilds[bestGuild.guild].longText} (${guilds[bestGuild.guild].level}) gouverne désormais le royaume. Gloire à la royauté !`;

            if ("" !== oldKing.king) {
                message += ` Mais restez vigilants, ${oldKing.king} (${users[oldKing.king].level}) ne laissera probablement pas passer l'affront et fera tout pour redorer l'image de la guilde ${guilds[oldKing.guild].longText} (${guilds[oldKing.guild].level}).`;
            }
            messageQueue.push(message);

            ioServ.emit(
                'displayEvent',
                {
                    'event': 'newKing',
                    'user': realm.king,
                    'data': {}
                }
            );
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
 * @param soft
 * @returns {string|*}
 */
function chooseSomeoneRandom(soft = false) {
    let totalUsers = Object.keys(users).length;
    let key = random.integer(0, totalUsers);

    let counter = 0;
    for (user in users) {
        if (key === counter) {
            if ('' === users[user].guild || (!soft && users[user].level < 2)) {
                return chooseSomeoneRandom(soft);
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
                messageQueue.push(`Acclamez tous ${master}, nouveau·elle Maître·esse de la guilde ${guild.longText} !`);
                ioServ.emit(
                    'displayEvent',
                    {
                        'event': 'newMaster',
                        'user': master,
                        'data': {
                            "guild": guild
                        }
                    }
                );
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
            message = `${user} (${stats.level}) est le·la Maître·sse de la guilde ${guild.longText} (${guild.level}).`;
        } else {
            let guildMaster = getMasterOfGuild(guild);
            message = `${user} (${stats.level}) est un·e disciple de la guilde ${guild.longText} (${guild.level}) sous les ordres de ${guildMaster} (${users[guildMaster].level}).`
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
    let popCount = populationCount();
    messageQueue.push(`${realm.king} (${users[realm.king].level}) de la guilde ${guilds[realm.kingGuild].longText} (${guilds[realm.kingGuild].level}) dirige le royaume peuplé de ${popCount} personnes.`)
}

/**
 * Retourne la population totale du royaume.
 *
 * @returns {number}
 */
function populationCount() {
    let popCount = 0;
    for (let u in users) {
        popCount++;
    }

    return popCount;
}

function displayComplot() {
    if (realm.kingSlayer > 0) {
        messageQueue.push(`Une rumeur dit qu'un complot se prépare contre le·la souverain·e. (${realm.kingSlayer}/${config.kingSlayerNeeded})`)
    } else {
        messageQueue.push(`Le royaume est en paix, et rien ne semble menacer le·la souverain·e ... pour combien de temps encore ?`)
    }
}

function displayRoyaume() {
    let totalLevels = countTotalLevels();
    let totalUsers = countTotalUsers();
    messageQueue.push(`Niveau du royaume : ${totalLevels} / Nombre d'habitant·e·s : ${totalUsers}`);
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
        message = `La guilde est dirigée par ${guild.master} (${users[guild.master].level})`

        let members = guild.members.length - 1;
        if (members === 1) {
            message += ` et ne possède aucun disciple.`;
        } else if (members >= 2) {
            message += ` et possède ${members} disciples.`;
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
function addToGuild(user, guild, keepLevel = false) {
    let previousGuild = null;

    for (let jsonGuild in guilds) {
        if (jsonGuild === guild) {
            if (!guilds[jsonGuild].members.includes(user)) {
                guilds[jsonGuild].members.push(user);
                updateUserGuild(user, jsonGuild, keepLevel);
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
function updateUserGuild(user, guild, keepLevel = false) {
    users[user].guild = guild;
    if (!keepLevel) {
        users[user].level = 1;
    }
}

/**
 * Add one tu the current user level.
 *
 * @param user
 * @returns {*}
 */
function increaseUserLevel(user, levels = 1) {
    let newLevel = users[user].level + levels;
    users[user].level = newLevel;

    return newLevel;
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

    ioServ.emit(
        'updateLevel',
        countTotalLevels()
    );
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