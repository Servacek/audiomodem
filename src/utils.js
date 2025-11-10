// Utils

export function max(array) {
    let max = -Infinity;
    for (let i = 0; i < array.length; i++ ) {
        if (array[i] > max) {
            max = array[i];
        }
    }

    return max;
}

export function formatDate(date) {
    const h = "0" + date.getHours();
    const m = "0" + date.getMinutes();

    return `${h.slice(-2)}:${m.slice(-2)}`;
}

export function nextPow2(N) {
    N--;
    N = (N >> 1) | N;
    N = (N >> 2) | N;
    N = (N >> 4) | N;
    N = (N >> 8) | N;
    N = (N >> 16) | N;
    return ++N;
}

// export function makeArrayPow2(arr) {
//     const nextArrPow2 = nextPow2(arr.length);

// }
