const fs = require('fs');

let guilds = require('./default/guilds.json');
let users = require('./default/users.json');
let realm = require('./default/realm.json');

saveFiles('backup');
saveFiles('dev');
saveFiles('jsons');

/**
 * Save the three files of a folder.
 *
 * @param folder
 */
function saveFiles(folder) {
    console.log(`Creating the default files for ${folder} folder.`);

    if (!fs.existsSync('./' + folder)){
        fs.mkdirSync('./' + folder);

        saveFile('./' + folder + '/guilds.json', guilds);
        saveFile('./' + folder + '/users.json', users);
        saveFile('./' + folder + '/realm.json', realm);
    } else {
        console.log(`Folder ${folder} already ready.`)
    }
}

/**
 * Actually save the file.
 *
 * @param file
 * @param content
 */
function saveFile(file, content) {
    fs.writeFile(file, JSON.stringify(content), function writeJSON(err) {
        if (err) {
            return console.log(err);
        }
    });
}