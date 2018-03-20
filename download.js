const http = require('http');
const url = require('url');
const scrapeIt = require("scrape-it");
const AdmZip = require('adm-zip');

function downloadZip(link) {
    return new Promise((resolve) => {
        const { country, title } = link;
        const locale = link.locale.replace('/', '');
        const zipUrl = link.url;
        const options = {
            host: url.parse(zipUrl).host,
            port: 80,
            path: url.parse(zipUrl).pathname
        };

        http.get(options, (res) => {
            const data = [];
            let dataLen = 0;

            res.on('data', (chunk) => {
                data.push(chunk);
                dataLen += chunk.length;
            })
                .on('end', () => {
                    const buf = new Buffer(dataLen);

                    for (let i = 0, len = data.length, pos = 0; i < len; i++) {
                        data[i].copy(buf, pos);
                        pos += data[i].length;
                    }

                    const zip = new AdmZip(buf);
                    const zipEntries = zip.getEntries();

                    zip.extractAllTo(`./source/${country}/${locale}/${title}/`, true);

                    return resolve();
                });
        });
    });
}

function downloadAll(links = [], i = links.length - 1) {
    return new Promise((resolve, reject) => {
        const link = links[i];

        if (!link) {
            return resolve();
        }

        console.log(link, i, links.length)

        downloadZip(link)
            .then(() => downloadAll(links, i -= 1))
            .then(resolve, reject);
    });
}

function finLinks() {
    return new Promise((resolve, reject) => {
        scrapeIt("https://ebible.org/bible/", {
            links: {
                listItem: "tr",
                data: {
                    country: 'td:nth-child(1)',
                    locale: 'td:nth-child(2)',
                    title: 'td:nth-child(3)',
                    url: {
                        selector: "td:nth-child(7) a",
                        attr: "href"
                    }
                }
            }
        }).then(page => {
            const { links } = page;

            if (!links.length) {
                return reject();
            }

            return resolve(links.filter(link => link.url).slice(599, 700));
        });
    });
}

finLinks().then(links => {
    downloadAll(links)
        .then(() => {
           console.log('end');
        });
});