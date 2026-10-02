def volcano(table, fdr=0.05):
    return {"kind": "volcano", "n": len(table), "fdr": fdr}


def heatmap(matrix):
    return {"kind": "heatmap", "rows": len(matrix)}
