const fs = require('fs');
const glob = require( 'glob' );
const xmlParser = require('xml2json');
const { parse, stringify } = require('himalaya');
const { merge, trim, flatMap } = require('lodash');
const XRegExp = require('xregexp');
const he = require('he');
const http = require('http');

function getContents(folder) {
    return new Promise(function(resolve, reject) {
        glob(`${folder}*.xml`, (err, contentsPaths) => {
            const contentsPath = contentsPaths[0];

            fs.readFile(contentsPath, function(err, data) {
                if (err) {
                    return reject(err);
                }

                const contents = JSON.parse(xmlParser.toJson(data)).vernacularParms.scriptureBook
                    .filter(abbr => abbr.parm === 'vernacularAbbreviatedName')
                    .reduce((obj, abbr) => merge(obj, {
                        [abbr.ubsAbbreviation]: {
                            name: abbr.$t,
                            files: []
                        }
                    }), {});

                return resolve(contents);
            });
        });
    });
}

function getPaths(folder) {
    return new Promise(function(resolve, reject) {
        glob(`${folder}/*[1-9]*([0-9]).htm`, (err, files) => {
            if (err) {
                return reject(err);
            }

            return resolve(files);
        });
    });
}

function mergePathsContents({ paths, contents }) {
    return new Promise(function(resolve) {
        const merged = paths
            .reduce((contents, file) => {
                const parts = file.match(XRegExp('(?:.\\/source\\/[\\p{L}\\sô\']+\\/.+\\/)([A-z]?[0-9]?[A-z]+)([0-9]+)(?:.htm)'));

                if (!parts) {
                    console.log(file);
                }

                const ubs = parts[1];
                const index = parts[2];


                if (!contents[ubs]) {
                    console.log(ubs, index);
                } else {
                    contents[ubs].files.push({
                        index,
                        path: file,
                    });
                }

                return contents;
            }, contents);

        return resolve(merged);
    });
}

function save({ bible, name }) {
    return new Promise((resolve, reject) => {
        const [ country, language, title ] = name.split('.');

        fs.writeFile(`./bibles/${title}.json`, JSON.stringify(bible), 'utf8', function(err) {
            if (err) {
                return reject(err);
            }

            http.get({
                host: 'restcountries.eu',
                port: 80,
                path: `/rest/v2/name/${encodeURI(country)}`
            }, (res) => {
                let output = '';

                res.on('data', function (chunk) {
                    output += chunk;
                });

                res.on('end', function() {
                    const found = JSON.parse(output).pop();
                    const countryCode = found.alpha2Code;
                    const lang = found.languages.find(lang => language.includes(lang.name));
                    const langCode = lang ? lang.iso639_1 : found.languages[0].iso639_1;

                    return resolve({ locale: `${langCode}-${countryCode}`, title });
                });
            });
        });
    });
}

function parsePage({ folder, page }) {
    return new Promise(function(resolve, reject) {
        fs.readFile(page.path, {encoding: 'utf8'}, function(err, html) {
            if (err) {
                return reject(err);
            }

            let main = parse(html)
                .find(node => node.tagName === 'html').children
                .find(node => node.tagName === 'body').children
                .find(node => node.attributes && node.attributes[0].value === 'main').children;

            const body = stringify(main);
            const regExp = /(?:<.+?id=['"]V[1-9][0-9]?['"]>)(.+?)(?:<.+?>)(.+?)(?:<)/gmi;

            let match;
            const verses = [];

            while (match = regExp.exec(body)) {
                const index = trim(he.decode(match[1]));
                const text = trim(he.decode(match[2]));

                if (regExp.lastIndex) {
                    regExp.lastIndex--;
                }

                verses.push({ index: `${page.index}:${index}`, text });
            }

            return resolve(verses);
        });
    });
}

function parseBook({ folder, book, info }) {
    return new Promise((resolve, reject) => {
        Promise.all(info.files.map(page => parsePage({ folder, page })))
            .then(pages => {
                const rows = flatMap(pages);

                return rows.length ? {
                    ubs: book,
                    name: info.name,
                    rows,
                } : undefined;
            })
            .then(resolve, reject);
    });
}
function formatBible(books, folder) {
    return new Promise((resolve, reject) => {
        Promise.all(Object.entries(books).map(([key, value]) => parseBook({ folder, book: key, info: value })))
            .then(books => books.filter(Boolean))
            .then(resolve, reject);
    });
}

function parseBible(folder) {
    return new Promise((resolve, reject) => {
        Promise.all([getContents(folder), getPaths(folder)])
            .then(([contents, paths]) => mergePathsContents({ paths, contents }))
            .then(books => formatBible(books, folder))
            .then(verses => save({
                bible: {
                    name: folder.split('/')[4],
                    verses,
                },
                name: folder
                    .replace('./source/', '')
                    .replace(/\//g, '.')
            }))
            .then(resolve, reject);
    });
}

function getFolders() {
    return new Promise((resolve, reject) => {
        glob( './source/*/*/*/', (err, folders) => {
            if (err) {
                return reject(err);
            }

            return resolve(folders);
        });
    });
}

function parseAll(folders = [], i = folders.length - 1, index = {}) {
    return new Promise((resolve, reject) => {
        const folder = folders[i];

        if (!folder) {
            return resolve();
        }

        parseBible(folder)
            .then(({ locale, title }) => {
                return parseAll(
                    folders,
                    i -= 1,
                    merge(
                        index,
                        { [locale]: [...(index[locale] || []), title],
                    }),
                )
            })
            .then(() => new Promise((resolve, reject) => {
                fs.writeFile(`./bibles/index.json`, JSON.stringify(index), 'utf8', (err) => {
                    if (err) {
                        return reject(err);
                    }

                    return resolve();
                })
            }))
            .then(resolve, reject);
    });
}

getFolders()
    .then(parseAll)
    .then(() => console.log('parsed'));