function formatDateTime(d: Date) {
    let month = '' + (d.getUTCMonth() + 1); // getUTCMonth returns months from 0-11
    let day = '' + d.getUTCDate();
    let year = d.getUTCFullYear();
    let hour = '' + d.getUTCHours();
    let minute = '' + d.getUTCMinutes();

    // Pad with zeros if necessary
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    hour = hour.padStart(2, '0');
    minute = minute.padStart(2, '0');

    return `${month}/${day}/${year} ${hour}:${minute} GMT+0`;
}

export async function loadCompany(url: any) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }

        const company = await response.json();
        return {
            success: true,
            data: {
                company,
                remoteTime: formatDateTime(new Date(response.headers.get("Last-Modified")!)),
                localTime: formatDateTime(new Date()),
            }
        };
    } catch (error) {
        return {
            success: false,
            msg: 'There has been a problem with your fetch operation'
        };
    }
}