import osmnx as ox
#import matplotlib.pyplot as plt

center = (37.503643, 126.956024)  # 중앙대 310관 근처
G = ox.graph_from_point(center, dist=1200, network_type="walk")

gdf_edges = ox.graph_to_gdfs(G, nodes=False)
print(gdf_edges.columns)
print(gdf_edges[["name", "highway", "length"]].head())

ox.plot_graph(G)
