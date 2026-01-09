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

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(id);
    }
}

export async function getRemoteCompanyTimestamp(url: string) {
    try {
        // Prefer HEAD so we don't download the whole JSON just to see if it changed.
        // If the server does not support HEAD or does not include Last-Modified, fall back to GET.
        let response = await fetchWithTimeout(url, { method: 'HEAD' }, 8000);
        if (!response.ok || !response.headers.get('Last-Modified')) {
            response = await fetchWithTimeout(url, { method: 'GET' }, 8000);
        }

        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }

        const lastModified = response.headers.get('Last-Modified');
        const remoteMs = lastModified ? new Date(lastModified).getTime() : NaN;

        return {
            success: true,
            remoteMs: isNaN(remoteMs) ? null : remoteMs,
            remoteTime: lastModified ? formatDateTime(new Date(lastModified)) : 'Unknown'
        };
    } catch (error) {
        return {
            success: false,
            msg: 'There has been a problem checking the remote timestamp'
        };
    }
}

export async function loadCompany(url: any) {
    try {
        const response = await fetchWithTimeout(url, { method: 'GET' }, 15000);
        if (!response.ok) {
            throw new Error('Network response was not ok ' + response.statusText);
        }

        const company = await response.json();
        const lastModified = response.headers.get("Last-Modified");
        const remoteMs = lastModified ? new Date(lastModified).getTime() : NaN;
        const localMs = Date.now();
        return {
            success: true,
            data: {
                company,
                sourceUrl: url,
                // remoteMs = current remote timestamp as reported by the server
                remoteMs: isNaN(remoteMs) ? null : remoteMs,
                // localRemoteMs = remote timestamp at the time this library was downloaded
                localRemoteMs: isNaN(remoteMs) ? null : remoteMs,
                localMs,
                remoteTime: lastModified ? formatDateTime(new Date(lastModified)) : 'Unknown',
                localTime: formatDateTime(new Date(localMs)),
            }
        };
    } catch (error) {
        return {
            success: false,
            msg: 'There has been a problem with your fetch operation'
        };
    }
}